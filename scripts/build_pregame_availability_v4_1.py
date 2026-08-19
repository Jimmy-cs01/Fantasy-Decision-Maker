#!/usr/bin/env python3
"""Build full-roster pregame availability events and teammate-vacancy features."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

if __package__:
    from .projection_pipeline.v3_2_config import V3_2_FEATURE_DATASET_PATH
    from .projection_pipeline.v4_role_state import (
        load_years, normalize_team, prepare_depth_charts, prepare_injuries, prepare_weekly_rosters,
    )
else:
    from projection_pipeline.v3_2_config import V3_2_FEATURE_DATASET_PATH
    from projection_pipeline.v4_role_state import (
        load_years, normalize_team, prepare_depth_charts, prepare_injuries, prepare_weekly_rosters,
    )

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/v4_role"
EVENTS = ROOT / "data/processed/player_week_availability_events_v4_1.csv.gz"
FEATURES = ROOT / "data/processed/player_week_availability_v4_1.csv.gz"
REPORT = ROOT / "data/processed/player_week_availability_v4_1.report.json"
YEARS = range(2018, 2026)
STRUCTURAL_UNAVAILABLE = {"RES", "PUP", "SUS", "CUT", "RET", "NWT", "UFA", "DEV"}


def add_rolling_prior(panel: pd.DataFrame, value: str, output: str) -> None:
    panel[output] = panel.groupby(["player_id", "team"], sort=False)[value].transform(
        lambda series: series.shift().rolling(3, min_periods=1).mean()
    )


def weeks_since_prior_opportunity(values: pd.Series) -> pd.Series:
    """Count observed player-weeks since the last prior opportunity without leakage."""
    result: list[float] = []
    last_opportunity: int | None = None
    for offset, had_opportunity in enumerate(values.astype(bool)):
        result.append(np.nan if last_opportunity is None else float(offset - last_opportunity))
        if had_opportunity:
            last_opportunity = offset
    return pd.Series(result, index=values.index, dtype="float64")


def main() -> None:
    schedules = pd.read_csv(ROOT / "data/processed/schedules.csv")
    schedules["team"] = schedules.team.map(normalize_team)
    schedules["kickoff"] = pd.to_datetime(schedules.kickoff, utc=True, errors="coerce")
    schedules["feature_cutoff"] = schedules.kickoff - pd.Timedelta(hours=24)
    schedule = schedules.loc[schedules.season.isin(YEARS), [
        "season", "week", "team", "game_id", "kickoff", "feature_cutoff",
    ]]

    raw_rosters = load_years(RAW, "roster_weekly", YEARS)
    rosters = prepare_weekly_rosters(raw_rosters)
    raw_status = raw_rosters.loc[raw_rosters.gsis_id.notna(), ["season", "week", "gsis_id", "status"]]
    raw_status = raw_status.sort_values(["season", "week", "gsis_id"]).drop_duplicates(["season", "week", "gsis_id"], keep="last")
    rosters = rosters.merge(raw_status.rename(columns={"gsis_id": "player_id", "status": "roster_status"}),
                            on=["player_id", "season", "week"], how="left", validate="one_to_one")
    panel = rosters.merge(schedule, on=["season", "week", "team"], how="left", validate="many_to_one")
    panel = panel.loc[panel.game_id.notna()].sort_values(["player_id", "season", "week"]).reset_index(drop=True)

    depth = prepare_depth_charts(load_years(RAW, "depth_charts", YEARS)).rename(columns={"team": "depth_team"})
    panel = panel.merge(depth, on=["player_id", "season", "week"], how="left", validate="one_to_one")
    injuries = prepare_injuries(load_years(RAW, "injuries", YEARS), schedules, cutoff_hours=24).rename(columns={"team": "injury_team"})
    panel = panel.merge(injuries, on=["player_id", "season", "week"], how="left", validate="one_to_one")

    status = panel.roster_status.astype("string").str.upper()
    panel["structurally_unavailable"] = status.isin(STRUCTURAL_UNAVAILABLE).astype(int)
    # INA is commonly a game-day state without a trustworthy 24-hour timestamp;
    # preserve the event but never use it as a 24-hour known-inactive feature.
    panel["game_day_inactive_unusable_24h"] = status.eq("INA").astype(int)
    report_status = panel.get("injury_severity", pd.Series(0, index=panel.index)).fillna(0)
    panel["is_out_known"] = report_status.ge(1).astype(int)
    panel["is_doubtful"] = report_status.between(.79, .99).astype(int)
    panel["is_questionable"] = report_status.between(.3, .79).astype(int)
    panel["is_active_expected"] = (1 - np.maximum(panel.structurally_unavailable, panel.is_out_known)).astype(int)
    panel["availability_observed"] = (
        panel.roster_status.notna() | panel.injury_observed.fillna(0).eq(1)
    ).astype(int)
    panel["availability_confidence"] = np.clip(
        .45 * panel.roster_status.notna().astype(int)
        + .35 * panel.injury_observed.fillna(0)
        + .20 * panel.depth_observed.fillna(0), 0, 1,
    )

    panel["team_changed"] = panel.groupby("player_id", sort=False).team.transform(
        lambda values: values.ne(values.shift()).astype(int)
    )
    first = panel.groupby("player_id", sort=False).head(1).index
    panel.loc[first, "team_changed"] = 0
    panel["weeks_since_team_change"] = panel.groupby("player_id", sort=False).team_changed.transform(
        lambda values: values.groupby(values.cumsum()).cumcount()
    )

    actual = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    actual["team"] = actual.team.map(normalize_team)
    actual = actual[["player_id", "season", "week", "team", "rush_attempts", "targets"]]
    panel = panel.merge(actual, on=["player_id", "season", "week", "team"], how="left", validate="one_to_one")
    panel[["rush_attempts", "targets"]] = panel[["rush_attempts", "targets"]].fillna(0)
    team_totals = panel.groupby(["season", "week", "team"], dropna=False)[["rush_attempts", "targets"]].transform("sum")
    panel["actual_rush_share"] = panel.rush_attempts / team_totals.rush_attempts.replace(0, np.nan)
    panel["actual_target_share"] = panel.targets / team_totals.targets.replace(0, np.nan)
    add_rolling_prior(panel, "actual_rush_share", "prior_rush_share_l3")
    add_rolling_prior(panel, "actual_target_share", "prior_target_share_l3")
    panel["had_opportunity"] = panel[["rush_attempts", "targets"]].sum(axis=1).gt(0)
    panel["weeks_since_last_opportunity"] = panel.groupby("player_id", sort=False)["had_opportunity"].transform(
        weeks_since_prior_opportunity
    )
    prior_unavailable = panel.groupby("player_id", sort=False).structurally_unavailable.shift().fillna(0)
    panel["returning_from_injury_or_reserve"] = (
        prior_unavailable.eq(1) & panel.structurally_unavailable.eq(0)
    ).astype(int)

    room_keys = ["season", "week", "team", "position"]
    panel["vacated_rush_piece"] = panel.prior_rush_share_l3.fillna(0) * (1 - panel.is_active_expected)
    panel["vacated_target_piece"] = panel.prior_target_share_l3.fillna(0) * (1 - panel.is_active_expected)
    room = panel.groupby(room_keys, dropna=False)
    panel["room_active_count"] = room.is_active_expected.transform("sum")
    panel["room_unavailable_count"] = room.is_active_expected.transform(lambda values: int((values == 0).sum()))
    panel["vacated_room_rush_share"] = room.vacated_rush_piece.transform("sum")
    panel["vacated_room_target_share"] = room.vacated_target_piece.transform("sum")
    panel["top_competitor_out"] = room.vacated_target_piece.transform("max").gt(.08).astype(int)
    panel["starter_unavailable_piece"] = (
        panel.depth_rank.eq(1) & panel.is_active_expected.eq(0)
    ).astype(int)
    panel["starter_ahead_unavailable"] = room.starter_unavailable_piece.transform("max")
    panel["depth_rank_improved"] = panel.groupby("player_id", sort=False).depth_rank.transform(
        lambda values: values.shift().sub(values).gt(0).astype(int)
    )
    panel["depth_rank_declined"] = panel.groupby("player_id", sort=False).depth_rank.transform(
        lambda values: values.sub(values.shift()).gt(0).astype(int)
    )
    panel["new_starter_probability"] = np.clip(
        .55 * panel.depth_rank.eq(1).astype(float)
        + .25 * panel.starter_ahead_unavailable
        + .20 * panel.depth_rank_improved,
        0, 1,
    )

    events = []
    for row in panel.itertuples():
        base = {"season": row.season, "week": row.week, "game_id": row.game_id,
                "player_id": row.player_id, "team": row.team}
        events.append({**base, "event_timestamp": None, "event_type": "roster_status",
                       "event_value": row.roster_status, "source": "nflverse_weekly_rosters"})
        if pd.notna(row.date_modified):
            events.append({**base, "event_timestamp": row.date_modified, "event_type": "injury_report",
                           "event_value": str(row.injury_severity), "source": "nflverse_injuries"})
        if row.team_changed:
            events.append({**base, "event_timestamp": None, "event_type": "team_changed",
                           "event_value": row.team, "source": "nflverse_weekly_rosters"})
    pd.DataFrame(events).to_csv(EVENTS, index=False, compression="gzip")

    feature_columns = [
        "player_id", "season", "week", "game_id", "team", "position", "roster_status",
        "is_active_expected", "is_out_known", "is_questionable", "is_doubtful",
        "structurally_unavailable", "game_day_inactive_unusable_24h", "availability_observed",
        "availability_confidence", "practice_limited", "injury_observed", "depth_rank", "starter",
        "team_changed", "weeks_since_team_change", "weeks_since_last_opportunity",
        "returning_from_injury_or_reserve", "room_active_count", "room_unavailable_count",
        "vacated_room_rush_share", "vacated_room_target_share", "top_competitor_out",
        "starter_ahead_unavailable", "depth_rank_improved", "depth_rank_declined",
        "new_starter_probability", "prior_rush_share_l3", "prior_target_share_l3",
        "actual_rush_share", "actual_target_share", "rush_attempts", "targets",
    ]
    panel[feature_columns].to_csv(FEATURES, index=False, compression="gzip")
    report = {
        "feature_version": "pregame_availability_v1", "cutoff_hours": 24,
        "player_weeks": len(panel), "events": len(events), "seasons": list(YEARS),
        "known_out": int(panel.is_out_known.sum()), "structurally_unavailable": int(panel.structurally_unavailable.sum()),
        "game_day_inactive_rows_excluded_from_24h_feature": int(panel.game_day_inactive_unusable_24h.sum()),
        "team_changes": int(panel.team_changed.sum()), "returning_rows": int(panel.returning_from_injury_or_reserve.sum()),
        "starter_ahead_unavailable": int(panel.starter_ahead_unavailable.sum()),
        "duplicates": int(panel.duplicated(["player_id", "season", "week"]).sum()),
        "production_unchanged": True,
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
