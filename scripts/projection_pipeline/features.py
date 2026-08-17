from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import numpy as np
import pandas as pd

from .config import (
    BOX_SCORE_COLUMNS,
    FANTASY_POSITIONS,
    IDENTITY_COLUMNS,
    POSITION_CODES,
    REQUIRED_SOURCE_COLUMNS,
    ROLLING_STATS,
    ROLLING_WINDOWS,
)

LOGICAL_KEY = ["player_id", "season", "week", "season_type", "game_id"]


def read_historical_stats(path: Path) -> pd.DataFrame:
    """Read only projection inputs from the normalized historical export."""
    available = pd.read_csv(path, nrows=0).columns.tolist()
    missing = sorted(set(IDENTITY_COLUMNS) - set(available))
    if missing:
        raise ValueError(f"Historical stats are missing required identity columns: {missing}")
    usecols = [column for column in REQUIRED_SOURCE_COLUMNS if column in available]
    frame = pd.read_csv(path, usecols=usecols, dtype={"player_id": "string"})
    for column in BOX_SCORE_COLUMNS:
        if column not in frame:
            frame[column] = np.nan
    return frame


def validate_historical_rows(frame: pd.DataFrame) -> None:
    missing = sorted(set(IDENTITY_COLUMNS) - set(frame.columns))
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    if frame[["player_id", "season", "week"]].isna().any().any():
        raise ValueError("player_id, season, and week must not be null")
    duplicates = frame.duplicated(LOGICAL_KEY, keep=False)
    if duplicates.any():
        raise ValueError(f"Found {int(duplicates.sum())} duplicate player-week identities")


def _pregame_mean(frame: pd.DataFrame, column: str, group: Iterable[str]) -> pd.Series:
    keys = [frame[name] for name in group]
    values = frame[column].fillna(0)
    present = frame[column].notna().astype(int)
    prior_sum = values.groupby(keys, sort=False, dropna=False).cumsum() - values
    prior_count = present.groupby(keys, sort=False, dropna=False).cumsum() - present
    return prior_sum / prior_count.replace(0, np.nan)


def _pregame_rolling(frame: pd.DataFrame, column: str, window: int) -> pd.Series:
    shifted = frame.groupby("player_id", sort=False)[column].shift(1)
    return (
        shifted.groupby(frame["player_id"], sort=False)
        .rolling(window, min_periods=1)
        .mean()
        .reset_index(level=0, drop=True)
        .sort_index()
    )


def _pregame_sum(frame: pd.DataFrame, column: str) -> pd.Series:
    grouped = frame.groupby(["player_id", "season"], sort=False)[column]
    return grouped.cumsum() - frame[column].fillna(0)


def _safe_rate(numerator: pd.Series, denominator: pd.Series, minimum: float) -> pd.Series:
    return numerator.div(denominator.where(denominator >= minimum))


def _prior_season_features(frame: pd.DataFrame) -> pd.DataFrame:
    prior = frame.groupby(
        ["player_id", "season", "historical_position"], as_index=False
    ).agg(
        prior_season_games=("game_id", "nunique"),
        prior_season_ppr_points=("fantasy_points_ppr", "sum"),
        prior_season_rush_attempts=("rush_attempts", "sum"),
        prior_season_targets=("targets", "sum"),
        prior_season_receptions=("receptions", "sum"),
        prior_season_true_touches=("true_touches", "sum"),
    )
    games = prior["prior_season_games"].replace(0, np.nan)
    prior["prior_season_ppr_ppg"] = prior["prior_season_ppr_points"] / games
    for column in ["rush_attempts", "targets", "receptions", "true_touches"]:
        prior[f"prior_season_{column}_pg"] = prior[f"prior_season_{column}"] / games
    rank = prior.groupby(["season", "historical_position"])["prior_season_ppr_ppg"].rank(
        method="average", ascending=False, pct=True
    )
    prior["prior_season_position_rank_pct"] = 1 - rank
    prior["season"] = prior["season"] + 1
    keep = [
        "player_id", "season", "prior_season_games", "prior_season_ppr_ppg",
        "prior_season_position_rank_pct", "prior_season_rush_attempts_pg",
        "prior_season_targets_pg", "prior_season_receptions_pg",
        "prior_season_true_touches_pg",
    ]
    return prior[keep]


def _attach_schedule(frame: pd.DataFrame, schedule: pd.DataFrame | None) -> pd.DataFrame:
    context = [
        "opponent_team", "is_home", "neutral_site", "days_rest", "short_week",
        "long_rest", "returning_from_bye", "is_thursday",
    ]
    if schedule is None:
        for column in context[1:]:
            frame[column] = np.nan
        return frame
    keys = ["season", "week", "season_type", "team"]
    missing = sorted(set(keys + context) - set(schedule.columns))
    if missing:
        raise ValueError(f"Normalized schedule is missing columns: {missing}")
    base = frame.drop(columns=[column for column in context if column in frame], errors="ignore")
    return base.merge(schedule[keys + context], on=keys, how="left", validate="many_to_one")


def _opponent_features(frame: pd.DataFrame) -> pd.DataFrame:
    defense = frame.assign(
        _touchdowns=frame["passing_touchdowns"].fillna(0)
        + frame["rushing_touchdowns"].fillna(0)
        + frame["receiving_touchdowns"].fillna(0)
    ).groupby(
        ["season", "week", "opponent_team", "historical_position"],
        as_index=False,
        dropna=False,
    ).agg(
        fantasy_points=("fantasy_points_ppr", "sum"),
        passing_yards=("passing_yards", "sum"),
        rushing_yards=("rushing_yards", "sum"),
        receiving_yards=("receiving_yards", "sum"),
        touchdowns=("_touchdowns", "sum"),
        passing_tds=("passing_touchdowns", "sum"),
        rushing_tds=("rushing_touchdowns", "sum"),
        receiving_tds=("receiving_touchdowns", "sum"),
    ).sort_values(["season", "opponent_team", "historical_position", "week"])

    group = ["season", "opponent_team", "historical_position"]
    for source, label in [
        ("fantasy_points", "fantasy_points_allowed"),
        ("passing_yards", "passing_yards_allowed"),
        ("rushing_yards", "rushing_yards_allowed"),
        ("receiving_yards", "receiving_yards_allowed"),
        ("touchdowns", "touchdowns_allowed"),
    ]:
        defense[f"opp_{label}_season"] = _pregame_mean(defense, source, group)

    for source, label in [
        ("fantasy_points", "fantasy_points_allowed"),
        ("passing_yards", "passing_yards_allowed"),
        ("rushing_yards", "rushing_yards_allowed"),
        ("receiving_yards", "receiving_yards_allowed"),
        ("passing_tds", "passing_tds_allowed"),
        ("rushing_tds", "rushing_tds_allowed"),
        ("receiving_tds", "receiving_tds_allowed"),
    ]:
        shifted = defense.groupby(group, sort=False)[source].shift(1)
        defense[f"opp_{label}_l4"] = (
            shifted.groupby([defense[column] for column in group], sort=False)
            .rolling(4, min_periods=1)
            .mean()
            .reset_index(level=[0, 1, 2], drop=True)
            .sort_index()
        )
    defense["opp_fantasy_points_allowed_l3"] = (
        defense.groupby(group, sort=False)["fantasy_points"].shift(1)
        .groupby([defense[column] for column in group], sort=False)
        .rolling(3, min_periods=1).mean()
        .reset_index(level=[0, 1, 2], drop=True).sort_index()
    )
    columns = ["season", "week", "opponent_team", "historical_position"] + [
        column for column in defense if column.startswith("opp_")
    ]
    return defense[columns]


def build_modeling_dataset(raw: pd.DataFrame, schedule: pd.DataFrame | None = None) -> pd.DataFrame:
    """Return one pregame feature row per REG-season fantasy player game."""
    validate_historical_rows(raw)
    frame = raw.loc[
        raw["season_type"].eq("REG")
        & raw["historical_position"].isin(FANTASY_POSITIONS)
    ].copy()
    frame = frame.sort_values(["player_id", "season", "week", "game_id"]).reset_index(drop=True)
    numeric = [column for column in BOX_SCORE_COLUMNS if column in frame]
    frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
    frame["position_code"] = frame["historical_position"].map(POSITION_CODES)
    frame = _attach_schedule(frame, schedule)
    prior = _prior_season_features(frame.loc[~frame["game_id"].eq("__projection__")])
    frame = frame.merge(prior, on=["player_id", "season"], how="left", validate="many_to_one")
    frame["has_prior_season"] = frame["prior_season_games"].gt(0).astype(int)
    frame["games_played_before"] = frame.groupby(["player_id", "season"], sort=False).cumcount()
    frame["career_games_before"] = frame.groupby("player_id", sort=False).cumcount()

    for column in ROLLING_STATS:
        frame[f"{column}_season_avg"] = _pregame_mean(
            frame, column, ["player_id", "season"]
        )
        for window in ROLLING_WINDOWS:
            frame[f"{column}_l{window}"] = _pregame_rolling(frame, column, window)

    attempts = _pregame_sum(frame, "pass_attempts")
    completions = _pregame_sum(frame, "completions")
    pass_yards = _pregame_sum(frame, "passing_yards")
    pass_tds = _pregame_sum(frame, "passing_touchdowns")
    interceptions = _pregame_sum(frame, "interceptions_thrown")
    carries = _pregame_sum(frame, "rush_attempts")
    rush_yards = _pregame_sum(frame, "rushing_yards")
    targets = _pregame_sum(frame, "targets")
    receptions = _pregame_sum(frame, "receptions")
    receiving_yards = _pregame_sum(frame, "receiving_yards")
    receiving_tds = _pregame_sum(frame, "receiving_touchdowns")
    frame["completion_percentage_season"] = _safe_rate(completions, attempts, 20)
    frame["yards_per_pass_attempt_season"] = _safe_rate(pass_yards, attempts, 20)
    frame["passing_td_rate_season"] = _safe_rate(pass_tds, attempts, 20)
    frame["interception_rate_season"] = _safe_rate(interceptions, attempts, 20)
    frame["yards_per_carry_season"] = _safe_rate(rush_yards, carries, 10)
    frame["yards_per_target_season"] = _safe_rate(receiving_yards, targets, 8)
    frame["yards_per_reception_season"] = _safe_rate(receiving_yards, receptions, 5)
    frame["receiving_td_rate_season"] = _safe_rate(receiving_tds, targets, 8)

    matchup = _opponent_features(frame)
    frame = frame.merge(
        matchup,
        on=["season", "week", "opponent_team", "historical_position"],
        how="left",
        validate="many_to_one",
    )
    return frame.sort_values(["season", "week", "player_id"]).reset_index(drop=True)


def build_inference_dataset(
    raw: pd.DataFrame,
    season: int,
    week: int,
    schedule: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Append target-week placeholders, then calculate their pregame features."""
    history = raw.loc[
        (raw["season"] < season)
        | ((raw["season"] == season) & (raw["week"] < week))
    ].copy()
    fantasy = history.loc[history["historical_position"].isin(FANTASY_POSITIONS)]
    latest = fantasy.sort_values(["season", "week"]).groupby("player_id", as_index=False).tail(1)
    latest = latest.loc[latest["season"] >= season - 1].copy()
    manual_schedule = schedule is not None and "player_id" in schedule.columns
    if manual_schedule:
        required = {"player_id", "opponent_team"}
        if not required.issubset(schedule.columns):
            raise ValueError("Schedule must contain player_id and opponent_team")
        schedule = schedule.copy()
        schedule["player_id"] = schedule["player_id"].astype("string")
        latest = latest.drop(columns=["opponent_team"]).merge(
            schedule[["player_id", "opponent_team"]], on="player_id", how="inner", validate="one_to_one"
        )
    elif schedule is None:
        latest["opponent_team"] = pd.NA
    latest["season"] = season
    latest["week"] = week
    latest["season_type"] = "REG"
    latest["game_id"] = "__projection__"
    for column in BOX_SCORE_COLUMNS:
        latest[column] = np.nan
    combined = pd.concat([history, latest], ignore_index=True, sort=False)
    modeled = build_modeling_dataset(combined, None if manual_schedule else schedule)
    return modeled.loc[modeled["game_id"].eq("__projection__")].reset_index(drop=True)
