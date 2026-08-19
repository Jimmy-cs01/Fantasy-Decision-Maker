#!/usr/bin/env python3
"""Build the local-only v4 historical pregame role-state layer."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from projection_pipeline.v3_2_config import V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v4_role_state import (
    load_years, merge_role_state, prepare_depth_charts, prepare_injuries, prepare_weekly_rosters,
)

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/v4_role"
OUTPUT = ROOT / "data/processed/player_week_role_state_v4.csv.gz"
REPORT = ROOT / "data/processed/player_week_role_state_v4.report.json"
YEARS = range(2018, 2026)


def main() -> None:
    base = pd.read_csv(
        V3_2_FEATURE_DATASET_PATH,
        usecols=["player_id", "season", "week", "team", "historical_position"],
        dtype={"player_id": "string", "team": "string"},
    ).sort_values(["player_id", "season", "week"])
    schedules = pd.read_csv(ROOT / "data/processed/schedules.csv")
    rosters = prepare_weekly_rosters(load_years(RAW, "roster_weekly", YEARS))
    depth = prepare_depth_charts(load_years(RAW, "depth_charts", YEARS))
    injuries = prepare_injuries(load_years(RAW, "injuries", YEARS), schedules, cutoff_hours=24)
    output = merge_role_state(base, rosters, depth, injuries)
    output.to_csv(OUTPUT, index=False, compression="gzip")
    report = {
        "feature_version": "pregame_role_state_v1",
        "prediction_cutoff": "24 hours before scheduled kickoff",
        "rows": len(output),
        "seasons": sorted(output.season.unique().tolist()),
        "roster_coverage": round(float(output.roster_team.notna().mean()), 6),
        "depth_coverage": round(float(output.depth_observed.mean()), 6),
        "injury_report_coverage": round(float(output.injury_observed.mean()), 6),
        "team_conflicts": int(output.team_conflict.sum()),
        "team_changes": int(output.team_changed.sum()),
        "duplicates": int(output.duplicated(["player_id", "season", "week"]).sum()),
        "source_rows": {"rosters": len(rosters), "depth": len(depth), "injuries_before_cutoff": len(injuries)},
        "provenance": {
            "rosters": "nflverse weekly_rosters; NFL Shield v2 API",
            "depth": "nflverse depth_charts",
            "injuries": "nflverse injuries; timestamp-filtered",
        },
        "production_unchanged": True,
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
