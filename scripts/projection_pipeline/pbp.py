from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .config import FANTASY_POSITIONS
from .v3_config import (
    EXPLOSIVE_RECEPTION_YARDS,
    EXPLOSIVE_RUSH_YARDS,
    GOAL_LINE_YARDLINE,
    NEUTRAL_SCORE_DIFFERENTIAL,
    PBP_FEATURE_VERSION,
)

PBP_COLUMNS = [
    "game_id", "season", "season_type", "week", "posteam", "defteam",
    "play_type", "qtr", "down", "goal_to_go", "yardline_100",
    "half_seconds_remaining", "score_differential", "qb_dropback", "qb_kneel",
    "qb_spike", "qb_scramble", "rush_attempt", "pass_attempt", "complete_pass",
    "sack", "interception", "touchdown", "pass_touchdown", "rush_touchdown",
    "first_down_pass", "yards_gained", "air_yards", "yards_after_catch", "epa",
    "success", "cpoe", "rusher_player_id", "rusher_player_name",
    "receiver_player_id", "receiver_player_name", "passer_player_id",
    "passer_player_name", "rushing_yards", "receiving_yards", "passing_yards",
    "aborted_play",
]

IDENTITY_KEY = [
    "player_id", "season", "week", "season_type", "game_id", "team",
    "opponent_team",
]
TEAM_KEY = ["season", "week", "season_type", "game_id", "team", "opponent_team"]


def read_pbp(path: Path) -> pd.DataFrame:
    available = pd.read_csv(path, nrows=0).columns.tolist()
    required = {
        "game_id", "season", "week", "posteam", "defteam", "rush_attempt",
        "pass_attempt", "rusher_player_id", "receiver_player_id", "passer_player_id",
    }
    missing = sorted(required - set(available))
    if missing:
        raise ValueError(f"{path} is missing required PBP columns: {missing}")
    usecols = [column for column in PBP_COLUMNS if column in available]
    frame = pd.read_csv(
        path,
        usecols=usecols,
        dtype={
            "game_id": "string", "posteam": "string", "defteam": "string",
            "rusher_player_id": "string", "receiver_player_id": "string",
            "passer_player_id": "string",
        },
        low_memory=False,
    )
    for column in PBP_COLUMNS:
        if column not in frame:
            frame[column] = np.nan
    return frame


def _numeric(frame: pd.DataFrame, column: str) -> pd.Series:
    return pd.to_numeric(frame[column], errors="coerce").fillna(0)


def _safe_divide(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator.div(denominator.replace(0, np.nan))


def _add_context(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    numeric = [
        "qtr", "down", "goal_to_go", "yardline_100", "half_seconds_remaining",
        "score_differential", "qb_dropback", "qb_kneel", "qb_spike", "qb_scramble",
        "rush_attempt", "pass_attempt", "complete_pass", "sack", "interception",
        "touchdown", "pass_touchdown", "rush_touchdown", "first_down_pass",
        "yards_gained", "air_yards", "yards_after_catch", "epa", "success", "cpoe",
        "rushing_yards", "receiving_yards", "passing_yards", "aborted_play",
    ]
    for column in numeric:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["season_type"] = frame["season_type"].fillna("REG").astype("string")
    yardline = frame["yardline_100"]
    score = frame["score_differential"]
    frame["_red_zone"] = yardline.le(20)
    frame["_inside_10"] = yardline.le(10)
    frame["_inside_5"] = yardline.le(5)
    frame["_goal_line"] = yardline.le(GOAL_LINE_YARDLINE)
    frame["_neutral"] = score.abs().le(NEUTRAL_SCORE_DIFFERENTIAL) & frame["qtr"].le(4)
    frame["_leading"] = score.gt(NEUTRAL_SCORE_DIFFERENTIAL)
    frame["_trailing"] = score.lt(-NEUTRAL_SCORE_DIFFERENTIAL)
    frame["_two_minute"] = frame["half_seconds_remaining"].le(120)
    frame["_early_down"] = frame["down"].le(2)
    frame["_third_down"] = frame["down"].eq(3)
    frame["_valid_play"] = (
        frame["posteam"].notna()
        & ~frame["qb_kneel"].eq(1)
        & ~frame["qb_spike"].eq(1)
        & ~frame["aborted_play"].eq(1)
    )
    return frame


def _team_week(frame: pd.DataFrame) -> pd.DataFrame:
    offense = frame.loc[frame["_valid_play"] & (
        frame["rush_attempt"].eq(1) | frame["qb_dropback"].eq(1) | frame["pass_attempt"].eq(1)
    )].copy()
    offense["team"] = offense["posteam"]
    offense["opponent_team"] = offense["defteam"]
    offense["_play"] = 1
    offense["_dropback"] = offense["qb_dropback"].eq(1).astype(int)
    offense["_pass"] = offense["pass_attempt"].eq(1).astype(int)
    offense["_rush"] = offense["rush_attempt"].eq(1).astype(int)
    offense["_target"] = (offense["pass_attempt"].eq(1) & offense["receiver_player_id"].notna()).astype(int)
    offense["_red_zone_play"] = offense["_red_zone"].astype(int)
    offense["_goal_to_go_play"] = offense["goal_to_go"].eq(1).astype(int)
    offense["_neutral_play"] = offense["_neutral"].astype(int)
    offense["_neutral_pass"] = (offense["_neutral"] & offense["qb_dropback"].eq(1)).astype(int)
    offense["_air_yards"] = offense["air_yards"].fillna(0).where(offense["_target"].eq(1), 0)
    return offense.groupby(TEAM_KEY, as_index=False, dropna=False).agg(
        team_offensive_plays=("_play", "sum"),
        team_dropbacks=("_dropback", "sum"),
        team_pass_attempts=("_pass", "sum"),
        team_rush_attempts=("_rush", "sum"),
        team_targets=("_target", "sum"),
        team_air_yards=("_air_yards", "sum"),
        team_red_zone_plays=("_red_zone_play", "sum"),
        team_goal_to_go_plays=("_goal_to_go_play", "sum"),
        team_neutral_plays=("_neutral_play", "sum"),
        team_neutral_passes=("_neutral_pass", "sum"),
    )


def _rusher_week(frame: pd.DataFrame) -> pd.DataFrame:
    rush = frame.loc[
        frame["_valid_play"] & frame["rush_attempt"].eq(1) & frame["rusher_player_id"].notna()
    ].copy()
    rush = rush.rename(columns={
        "rusher_player_id": "player_id", "rusher_player_name": "player_name",
        "posteam": "team", "defteam": "opponent_team",
    })
    rush["_one"] = 1
    rush["_designed"] = ~rush["qb_scramble"].eq(1)
    rush["_score"] = rush["score_differential"].fillna(0)
    for label, expression in {
        "_red_zone_carry": rush["_red_zone"],
        "_inside_10_carry": rush["_inside_10"],
        "_inside_5_carry": rush["_inside_5"],
        "_goal_line_carry": rush["_goal_line"],
        "_early_down_carry": rush["_early_down"],
        "_third_down_rush": rush["_third_down"],
        "_two_minute_rush": rush["_two_minute"],
        "_leading_rush": rush["_leading"],
        "_trailing_rush": rush["_trailing"],
        "_neutral_rush": rush["_neutral"],
        "_explosive": rush["rushing_yards"].ge(EXPLOSIVE_RUSH_YARDS),
        "_stuffed": rush["rushing_yards"].le(0),
    }.items():
        rush[label] = expression.astype(int)
    return rush.groupby(IDENTITY_KEY, as_index=False, dropna=False).agg(
        player_name=("player_name", "last"),
        pbp_rush_attempts=("_one", "sum"),
        designed_rushes=("_designed", "sum"),
        scrambles=("qb_scramble", "sum"),
        pbp_rushing_yards=("rushing_yards", "sum"),
        pbp_rushing_touchdowns=("rush_touchdown", "sum"),
        rush_epa=("epa", "sum"),
        rush_successes=("success", "sum"),
        red_zone_carries=("_red_zone_carry", "sum"),
        inside_10_carries=("_inside_10_carry", "sum"),
        inside_5_carries=("_inside_5_carry", "sum"),
        goal_line_carries=("_goal_line_carry", "sum"),
        early_down_carries=("_early_down_carry", "sum"),
        third_down_rushes=("_third_down_rush", "sum"),
        two_minute_rushes=("_two_minute_rush", "sum"),
        rushes_while_leading=("_leading_rush", "sum"),
        rushes_while_trailing=("_trailing_rush", "sum"),
        neutral_script_rushes=("_neutral_rush", "sum"),
        explosive_rushes=("_explosive", "sum"),
        stuffed_rushes=("_stuffed", "sum"),
        opportunity_score_differential_sum=("_score", "sum"),
        opportunity_score_differential_count=("_one", "sum"),
    )


def _receiver_week(frame: pd.DataFrame) -> pd.DataFrame:
    target = frame.loc[
        frame["_valid_play"] & frame["pass_attempt"].eq(1) & frame["receiver_player_id"].notna()
    ].copy()
    target = target.rename(columns={
        "receiver_player_id": "player_id", "receiver_player_name": "player_name",
        "posteam": "team", "defteam": "opponent_team",
    })
    target["_one"] = 1
    target["_air"] = target["air_yards"].fillna(0)
    target["_yac"] = target["yards_after_catch"].fillna(0)
    target["_end_zone"] = (
        target["air_yards"].notna() & target["yardline_100"].notna()
        & target["air_yards"].ge(target["yardline_100"])
    ).astype(int)
    target["_score"] = target["score_differential"].fillna(0)
    for label, expression in {
        "_red_zone_target": target["_red_zone"],
        "_inside_10_target": target["_inside_10"],
        "_first_down_target": target["first_down_pass"].eq(1),
        "_third_down_target": target["_third_down"],
        "_two_minute_target": target["_two_minute"],
        "_trailing_target": target["_trailing"],
        "_explosive": target["complete_pass"].eq(1) & target["receiving_yards"].ge(EXPLOSIVE_RECEPTION_YARDS),
    }.items():
        target[label] = expression.astype(int)
    return target.groupby(IDENTITY_KEY, as_index=False, dropna=False).agg(
        player_name=("player_name", "last"),
        pbp_targets=("_one", "sum"),
        pbp_receptions=("complete_pass", "sum"),
        pbp_receiving_yards=("receiving_yards", "sum"),
        pbp_receiving_touchdowns=("pass_touchdown", "sum"),
        pbp_air_yards=("_air", "sum"),
        pbp_yards_after_catch=("_yac", "sum"),
        target_epa=("epa", "sum"),
        target_successes=("success", "sum"),
        red_zone_targets=("_red_zone_target", "sum"),
        inside_10_targets=("_inside_10_target", "sum"),
        end_zone_targets=("_end_zone", "sum"),
        first_down_targets=("_first_down_target", "sum"),
        third_down_targets=("_third_down_target", "sum"),
        two_minute_targets=("_two_minute_target", "sum"),
        targets_while_trailing=("_trailing_target", "sum"),
        explosive_receptions=("_explosive", "sum"),
        opportunity_score_differential_sum=("_score", "sum"),
        opportunity_score_differential_count=("_one", "sum"),
    )


def _passer_week(frame: pd.DataFrame) -> pd.DataFrame:
    passing = frame.loc[
        frame["_valid_play"] & frame["qb_dropback"].eq(1) & frame["passer_player_id"].notna()
    ].copy()
    passing = passing.rename(columns={
        "passer_player_id": "player_id", "passer_player_name": "player_name",
        "posteam": "team", "defteam": "opponent_team",
    })
    passing["_one"] = 1
    passing["_pass_attempt"] = passing["pass_attempt"].eq(1).astype(int)
    passing["_air"] = passing["air_yards"].fillna(0).where(passing["pass_attempt"].eq(1), 0)
    passing["_cpoe"] = passing["cpoe"].fillna(0)
    passing["_cpoe_present"] = passing["cpoe"].notna().astype(int)
    for label, expression in {
        "_red_zone_pass": passing["_red_zone"] & passing["pass_attempt"].eq(1),
        "_inside_10_pass": passing["_inside_10"] & passing["pass_attempt"].eq(1),
        "_goal_to_go_pass": passing["goal_to_go"].eq(1) & passing["pass_attempt"].eq(1),
    }.items():
        passing[label] = expression.astype(int)
    return passing.groupby(IDENTITY_KEY, as_index=False, dropna=False).agg(
        player_name=("player_name", "last"),
        dropbacks=("_one", "sum"),
        pbp_pass_attempts=("_pass_attempt", "sum"),
        pbp_completions=("complete_pass", "sum"),
        pbp_passing_yards=("passing_yards", "sum"),
        pbp_passing_touchdowns=("pass_touchdown", "sum"),
        pbp_interceptions=("interception", "sum"),
        passing_epa=("epa", "sum"),
        pass_successes=("success", "sum"),
        cpoe_sum=("_cpoe", "sum"),
        cpoe_count=("_cpoe_present", "sum"),
        qb_air_yards=("_air", "sum"),
        sacks=("sack", "sum"),
        red_zone_pass_attempts=("_red_zone_pass", "sum"),
        inside_10_pass_attempts=("_inside_10_pass", "sum"),
        goal_to_go_pass_attempts=("_goal_to_go_pass", "sum"),
    )


def aggregate_pbp(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Aggregate one season of nflverse PBP into compact player/team weeks."""
    frame = frame.copy()
    for column in PBP_COLUMNS:
        if column not in frame:
            frame[column] = np.nan
    frame = _add_context(frame)
    team = _team_week(frame)
    pieces = [_rusher_week(frame), _receiver_week(frame), _passer_week(frame)]
    player = pieces[0]
    for piece in pieces[1:]:
        overlapping = [column for column in piece if column in player and column not in IDENTITY_KEY]
        rename = {column: f"{column}__next" for column in overlapping}
        player = player.merge(piece.rename(columns=rename), on=IDENTITY_KEY, how="outer", validate="one_to_one")
        for column in overlapping:
            other = f"{column}__next"
            if column == "player_name":
                player[column] = player[column].fillna(player[other])
            else:
                player[column] = player[column].fillna(0) + player[other].fillna(0)
            player = player.drop(columns=other)

    count_columns = [column for column in player if column not in IDENTITY_KEY + ["player_name"]]
    player[count_columns] = player[count_columns].fillna(0)
    player = player.merge(team, on=TEAM_KEY, how="left", validate="many_to_one")
    return player, team


def finalize_player_features(
    player: pd.DataFrame,
    historical: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, int]]:
    """Attach canonical positions and calculate shares/rates after PBP aggregation."""
    identity = historical.loc[
        historical["season_type"].eq("REG") & historical["historical_position"].isin(FANTASY_POSITIONS),
        ["player_id", "season", "week", "historical_position"],
    ].drop_duplicates(["player_id", "season", "week"])
    player["player_id"] = player["player_id"].astype("string")
    merged = player.merge(
        identity,
        on=["player_id", "season", "week"],
        how="left",
        validate="many_to_one",
    )
    source_players = int(merged["player_id"].nunique())
    missing_position = merged["historical_position"].isna()
    players_with_unmapped_weeks = int(merged.loc[missing_position, "player_id"].nunique())
    unmapped_player_weeks = int(missing_position.sum())
    merged = merged.loc[merged["historical_position"].isin(FANTASY_POSITIONS)].copy()

    for column in [
        "pbp_rush_attempts", "pbp_targets", "pbp_receptions", "red_zone_carries",
        "inside_10_carries", "inside_5_carries", "goal_line_carries", "red_zone_targets",
        "inside_10_targets", "rush_epa", "rush_successes", "explosive_rushes",
        "stuffed_rushes", "target_epa", "target_successes", "explosive_receptions",
        "dropbacks", "passing_epa", "pass_successes", "cpoe_sum", "cpoe_count",
        "qb_air_yards", "sacks", "team_offensive_plays", "team_rush_attempts",
        "team_targets", "team_air_yards", "team_dropbacks", "team_neutral_plays",
        "team_neutral_passes",
    ]:
        if column not in merged:
            merged[column] = 0.0

    merged["pbp_touches"] = merged["pbp_rush_attempts"] + merged["pbp_receptions"]
    merged["team_rush_share"] = _safe_divide(merged["pbp_rush_attempts"], merged["team_rush_attempts"])
    merged["pbp_target_share"] = _safe_divide(merged["pbp_targets"], merged["team_targets"])
    merged["pbp_air_yards_share"] = _safe_divide(merged["pbp_air_yards"], merged["team_air_yards"])
    merged["team_pass_rate"] = _safe_divide(merged["team_dropbacks"], merged["team_offensive_plays"])
    merged["team_neutral_pass_rate"] = _safe_divide(merged["team_neutral_passes"], merged["team_neutral_plays"])
    merged["rush_epa_per_attempt"] = _safe_divide(merged["rush_epa"], merged["pbp_rush_attempts"])
    merged["rush_success_rate"] = _safe_divide(merged["rush_successes"], merged["pbp_rush_attempts"])
    merged["explosive_rush_rate"] = _safe_divide(merged["explosive_rushes"], merged["pbp_rush_attempts"])
    merged["stuffed_rush_rate"] = _safe_divide(merged["stuffed_rushes"], merged["pbp_rush_attempts"])
    merged["target_epa_per_target"] = _safe_divide(merged["target_epa"], merged["pbp_targets"])
    merged["target_success_rate"] = _safe_divide(merged["target_successes"], merged["pbp_targets"])
    merged["yac_per_reception"] = _safe_divide(merged["pbp_yards_after_catch"], merged["pbp_receptions"])
    merged["explosive_reception_rate"] = _safe_divide(merged["explosive_receptions"], merged["pbp_receptions"])
    merged["pbp_adot"] = _safe_divide(merged["pbp_air_yards"], merged["pbp_targets"])
    merged["pass_epa_per_dropback"] = _safe_divide(merged["passing_epa"], merged["dropbacks"])
    merged["pass_success_rate"] = _safe_divide(merged["pass_successes"], merged["dropbacks"])
    merged["cpoe"] = _safe_divide(merged["cpoe_sum"], merged["cpoe_count"])
    merged["pass_adot"] = _safe_divide(merged["qb_air_yards"], merged["pbp_pass_attempts"])
    merged["sack_rate"] = _safe_divide(merged["sacks"], merged["dropbacks"])
    merged["qb_rush_epa_per_attempt"] = _safe_divide(merged["rush_epa"], merged["pbp_rush_attempts"])
    merged["red_zone_rushes"] = merged["red_zone_carries"]
    merged["goal_line_rushes"] = merged["goal_line_carries"]
    merged["third_down_opportunities"] = merged.get("third_down_rushes", 0) + merged.get("third_down_targets", 0)
    merged["two_minute_opportunities"] = merged.get("two_minute_rushes", 0) + merged.get("two_minute_targets", 0)
    merged["average_opportunity_score_differential"] = _safe_divide(
        merged["opportunity_score_differential_sum"],
        merged["opportunity_score_differential_count"],
    )

    backfield = merged["historical_position"].eq("RB")
    grouping = [merged[column] for column in ["season", "week", "team"]]
    rb_rushes = merged["pbp_rush_attempts"].where(backfield, 0).groupby(grouping, dropna=False).transform("sum")
    rb_targets = merged["pbp_targets"].where(backfield, 0).groupby(grouping, dropna=False).transform("sum")
    merged["backfield_rush_share"] = _safe_divide(merged["pbp_rush_attempts"], rb_rushes).where(backfield)
    merged["backfield_target_share"] = _safe_divide(merged["pbp_targets"], rb_targets).where(backfield)
    redzone_total = (
        merged["red_zone_carries"] + merged["red_zone_targets"]
    ).groupby(grouping, dropna=False).transform("sum")
    merged["red_zone_opportunity_share"] = _safe_divide(
        merged["red_zone_carries"] + merged["red_zone_targets"], redzone_total
    )
    goal_line_total = merged["goal_line_carries"].groupby(grouping, dropna=False).transform("sum")
    merged["goal_line_rush_share"] = _safe_divide(merged["goal_line_carries"], goal_line_total)
    merged["provider"] = "nflverse/pbp"
    merged["feature_version"] = PBP_FEATURE_VERSION
    report = {
        "source_players": source_players,
        "mapped_fantasy_players": int(merged["player_id"].nunique()),
        "players_with_unmapped_weeks": players_with_unmapped_weeks,
        "unmapped_player_weeks": unmapped_player_weeks,
        "mapped_player_weeks": int(len(merged)),
        "rows": int(len(merged)),
    }
    return merged.sort_values(["season", "week", "player_id"]).reset_index(drop=True), report
