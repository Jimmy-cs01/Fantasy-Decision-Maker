"""Leakage-safe historical role-state construction for projection model v4."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd


TEAM_ALIASES = {"JAC": "JAX", "LAR": "LA", "OAK": "LV", "SD": "LAC", "STL": "LA"}
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE"}
INJURY_SEVERITY = {"out": 1.0, "doubtful": .8, "questionable": .35, "probable": .1}


def normalize_team(value: object) -> str | None:
    if pd.isna(value):
        return None
    team = str(value).strip().upper()
    return TEAM_ALIASES.get(team, team) or None


def injury_severity(value: object) -> float:
    if pd.isna(value):
        return 0.0
    text = str(value).strip().lower()
    return max((score for key, score in INJURY_SEVERITY.items() if key in text), default=0.0)


def prepare_weekly_rosters(frame: pd.DataFrame) -> pd.DataFrame:
    """Return one trusted GSIS/team record per player-week."""
    rows = frame.loc[
        frame.gsis_id.notna() & frame.position.isin(FANTASY_POSITIONS)
    ].copy()
    rows["team"] = rows.team.map(normalize_team)
    rows["roster_active"] = rows.status.astype("string").str.upper().eq("ACT").astype(int)
    rows["roster_status_missing"] = rows.status.isna().astype(int)
    rows = rows.sort_values(
        ["season", "week", "gsis_id", "roster_active", "team"],
        ascending=[True, True, True, False, True],
    ).drop_duplicates(["season", "week", "gsis_id"], keep="first")
    return rows.rename(columns={"gsis_id": "player_id"})[[
        "player_id", "season", "week", "team", "position", "roster_active",
        "roster_status_missing", "years_exp", "rookie_year", "draft_number",
    ]]


def prepare_depth_charts(frame: pd.DataFrame) -> pd.DataFrame:
    rows = frame.loc[
        frame.gsis_id.notna()
        & frame.position.isin(FANTASY_POSITIONS)
        & frame.formation.astype("string").str.lower().eq("offense")
    ].copy()
    rows["team"] = rows.club_code.map(normalize_team)
    rows["depth_rank"] = pd.to_numeric(rows.depth_team, errors="coerce")
    rows = rows.sort_values(["season", "week", "gsis_id", "depth_rank"]).drop_duplicates(
        ["season", "week", "gsis_id"], keep="first"
    )
    rows["starter"] = rows.depth_rank.eq(1).astype(int)
    rows["depth_observed"] = 1
    return rows.rename(columns={"gsis_id": "player_id"})[[
        "player_id", "season", "week", "team", "depth_rank", "starter", "depth_observed",
    ]]


def prepare_injuries(frame: pd.DataFrame, schedules: pd.DataFrame, cutoff_hours: int = 24) -> pd.DataFrame:
    """Keep only injury information published before the explicit weekly cutoff."""
    rows = frame.loc[frame.gsis_id.notna()].copy()
    rows["team"] = rows.team.map(normalize_team)
    rows["date_modified"] = pd.to_datetime(rows.date_modified, utc=True, errors="coerce")
    schedule = schedules[["season", "week", "team", "kickoff"]].copy()
    schedule["team"] = schedule.team.map(normalize_team)
    schedule["kickoff"] = pd.to_datetime(schedule.kickoff, utc=True, errors="coerce")
    schedule["feature_cutoff"] = schedule.kickoff - pd.Timedelta(hours=cutoff_hours)
    rows = rows.merge(schedule, on=["season", "week", "team"], how="left", validate="many_to_one")
    rows = rows.loc[rows.date_modified.notna() & rows.feature_cutoff.notna() & rows.date_modified.le(rows.feature_cutoff)]
    rows = rows.sort_values("date_modified").drop_duplicates(["season", "week", "gsis_id"], keep="last")
    rows["injury_severity"] = rows.report_status.map(injury_severity)
    rows["practice_limited"] = rows.practice_status.astype("string").str.lower().str.contains(
        "limited|did not participate", na=False
    ).astype(int)
    rows["injury_observed"] = 1
    return rows.rename(columns={"gsis_id": "player_id"})[[
        "player_id", "season", "week", "team", "injury_severity", "practice_limited",
        "injury_observed", "date_modified", "feature_cutoff",
    ]]


def merge_role_state(
    base: pd.DataFrame,
    rosters: pd.DataFrame,
    depth: pd.DataFrame,
    injuries: pd.DataFrame,
) -> pd.DataFrame:
    keys = ["player_id", "season", "week"]
    output = base.copy()
    output["team"] = output.team.map(normalize_team)
    for source, prefix in ((rosters, "roster"), (depth, "depth"), (injuries, "injury")):
        renamed = source.rename(columns={"team": f"{prefix}_team"})
        output = output.merge(renamed, on=keys, how="left", validate="many_to_one")
    output["canonical_team"] = output.roster_team.combine_first(output.depth_team).combine_first(output.team)
    output["team_conflict"] = (
        output.roster_team.notna() & output.team.notna() & output.roster_team.ne(output.team)
    ).astype(int)
    output["team_changed"] = output.groupby("player_id", sort=False).canonical_team.transform(
        lambda series: series.ne(series.shift()).astype(int)
    )
    output.loc[output.groupby("player_id", sort=False).head(1).index, "team_changed"] = 0
    output["weeks_since_team_change"] = output.groupby("player_id", sort=False).team_changed.transform(
        lambda series: series.groupby(series.cumsum()).cumcount()
    )
    for column in ("depth_observed", "injury_observed"):
        if column not in output:
            output[column] = 0
        output[column] = output[column].fillna(0).astype(int)
    for column in ("depth_rank", "starter", "injury_severity", "practice_limited"):
        if column not in output:
            output[column] = np.nan
    # Missing remains explicit; neutral model inputs are separate columns.
    output["depth_rank_input"] = output.depth_rank.fillna(4).clip(1, 8)
    output["starter_input"] = output.starter.fillna(0)
    output["injury_severity_input"] = output.injury_severity.fillna(0)
    output["practice_limited_input"] = output.practice_limited.fillna(0)
    output["role_confidence"] = np.clip(
        .25 + .35 * output.depth_observed + .2 * output.starter_input
        + .2 * output.roster_active.fillna(0) - .25 * output.injury_severity_input,
        0, 1,
    )
    return output


def load_years(directory: Path, stem: str, years: range) -> pd.DataFrame:
    frames = [pd.read_csv(directory / f"{stem}_{year}.csv", low_memory=False) for year in years]
    return pd.concat(frames, ignore_index=True)
