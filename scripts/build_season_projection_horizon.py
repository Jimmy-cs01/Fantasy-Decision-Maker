#!/usr/bin/env python3
"""Expand a frozen active-game projection into a Week 1-17 outlook.

This is a storage/materialization layer, not a new model. It carries the frozen
football components forward, attaches the known schedule, emits zero-valued bye
rows, and never fabricates future Vegas or Sleeper evidence. Weekly production
runs can safely replace individual rows as real pregame context becomes known.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data/processed/player_projections_v4_1_release.csv"
DEFAULT_SCHEDULE = ROOT / "data/processed/schedules.csv"
DEFAULT_OUTPUT = ROOT / "data/processed/player_projections_v4_1_season.csv"
WEEKS = range(1, 18)


def zero_stats(value: object) -> str:
    stats = json.loads(str(value))
    return json.dumps({key: 0.0 for key in stats}, sort_keys=True)


def drivers(value: object, message: str) -> str:
    current = json.loads(str(value))
    return json.dumps([*current, message], sort_keys=True)


def build_horizon(base: pd.DataFrame, schedule: pd.DataFrame, season: int) -> pd.DataFrame:
    if base.duplicated(["gsis_id"]).any():
        raise ValueError("Projection seed must contain one row per player")
    games = schedule.loc[
        schedule.season.eq(season) & schedule.season_type.eq("REG") & schedule.week.between(1, 17),
        ["week", "team", "opponent_team"],
    ].drop_duplicates(["week", "team"])
    matchup = {(int(row.week), str(row.team)): str(row.opponent_team) for row in games.itertuples()}
    nfl_teams = set(games.team.astype(str))
    rows: list[dict] = []
    for source in base.to_dict("records"):
        team = None if pd.isna(source.get("team")) else str(source["team"])
        for week in WEEKS:
            row = dict(source)
            row.update({"season": season, "week": week, "season_type": "REG"})
            opponent = matchup.get((week, team)) if team else None
            teamless = not team or team not in nfl_teams
            bye = not teamless and opponent is None
            row["opponent_team"] = opponent
            row["is_bye"] = bye
            row["is_future_role_forecast"] = week != int(source.get("week", 1))
            if bye or teamless:
                row["projected_stats"] = zero_stats(source["projected_stats"])
                for column in (
                    "raw_model_projection_ppr", "opportunity_projection_ppr", "corrected_target_ppr",
                    "component_derived_ppr", "model_projection_ppr", "projected_points_standard",
                    "projected_points_half_ppr", "projected_points_ppr", "floor_ppr", "median_ppr", "ceiling_ppr",
                ):
                    if column in row:
                        row[column] = 0.0
                row["residual_low"] = 0.0
                row["residual_high"] = 0.0
                row["confidence"] = "high" if bye else "low"
                row["drivers"] = json.dumps(["NFL bye week" if bye else "No current NFL team"], sort_keys=True)
            elif week != int(source.get("week", 1)):
                row["drivers"] = drivers(source["drivers"], "Current role carried forward; future Vegas not fabricated")
                for column in (
                    "vegas_projection_ppr", "sleeper_projection_ppr", "final_projection_ppr",
                    "vegas_confidence", "blend_weight_model",
                ):
                    if column in row:
                        row[column] = None
                if week >= 9:
                    row["confidence"] = "low"
                elif week >= 5 and row.get("confidence") == "high":
                    row["confidence"] = "medium"
            rows.append(row)
    output = pd.DataFrame(rows).sort_values(["gsis_id", "week"]).reset_index(drop=True)
    if output.duplicated(["gsis_id", "season", "week", "season_type"]).any():
        raise ValueError("Season horizon contains duplicate player-week rows")
    expected = len(base) * 17
    if len(output) != expected:
        raise ValueError(f"Expected {expected} player-week rows, built {len(output)}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a leakage-safe Week 1-17 projection horizon.")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    base = pd.read_csv(args.input, dtype={"gsis_id": "string", "team": "string"})
    schedule = pd.read_csv(args.schedule, dtype={"team": "string", "opponent_team": "string"})
    output = build_horizon(base, schedule, args.season)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False)
    print(json.dumps({
        "players": int(output.gsis_id.nunique()),
        "weeks": sorted(output.week.unique().tolist()),
        "rows": len(output),
        "bye_rows": int(output.is_bye.sum()),
        "duplicates": int(output.duplicated(["gsis_id", "season", "week", "season_type"]).sum()),
        "future_vegas_fabricated": False,
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
