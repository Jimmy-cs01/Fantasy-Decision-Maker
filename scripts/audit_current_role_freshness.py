#!/usr/bin/env python3
"""Read-only current team/depth source audit for projection allocation."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

if __package__:
    from .audit_sleeper_week1_projections import sleeper_api_by_id
else:
    from audit_sleeper_week1_projections import sleeper_api_by_id


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/current_role_freshness_audit.json"
TEAM_ALIASES = {"LAR": "LA", "JAC": "JAX"}


def normalize_team(value: object) -> str | None:
    if pd.isna(value) or not str(value).strip():
        return None
    team = str(value).strip().upper()
    return TEAM_ALIASES.get(team, team)


def current_depth_rows(depth: pd.DataFrame) -> pd.DataFrame:
    ordered = depth.assign(
        _source_time=pd.to_datetime(depth.source_updated_at, errors="coerce", utc=True),
        _fetch_time=pd.to_datetime(depth.fetched_at, errors="coerce", utc=True),
    ).sort_values(["season", "_source_time", "_fetch_time"])
    return ordered.groupby("gsis_id", as_index=False).tail(1)


def build_audit(projections: pd.DataFrame, identities: pd.DataFrame, depth: pd.DataFrame, sleeper: dict) -> pd.DataFrame:
    latest_depth = current_depth_rows(depth)
    identity = identities[["player_id", "sleeper_player_id", "sleeper_current_team"]].drop_duplicates("player_id")
    output = projections[["gsis_id", "player_name", "team", "depth_position", "depth_rank", "is_starter"]].rename(
        columns={"team": "jimmy_current_team"},
    ).merge(identity, left_on="gsis_id", right_on="player_id", how="left", validate="one_to_one")
    output = output.merge(
        latest_depth[["gsis_id", "team", "depth_position", "depth_rank", "is_starter", "provider", "source_updated_at", "fetched_at"]].rename(columns={
            "team": "depth_team", "depth_position": "source_depth_position",
            "depth_rank": "source_depth_rank", "is_starter": "source_is_starter",
        }), on="gsis_id", how="left", validate="one_to_one",
    )
    sleeper_teams = {}
    for sleeper_id, row in sleeper.items():
        player = row.get("player") or {}
        sleeper_teams[str(sleeper_id)] = player.get("team")
    output["sleeper_api_team"] = output.sleeper_player_id.astype("string").map(sleeper_teams)
    output["team_conflict"] = output.apply(lambda row: len({
        normalize_team(value) for value in (
            row.jimmy_current_team, row.depth_team, row.sleeper_api_team, row.sleeper_current_team,
        ) if normalize_team(value)
    }) > 1, axis=1)
    output["missing_depth"] = output.depth_team.isna()
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    projections = pd.read_csv(ROOT / "data/processed/player_projections_v3_3_2.csv", dtype={"gsis_id": "string"})
    identities = pd.read_csv(ROOT / "data/processed/player_identity.csv", dtype="string")
    depth = pd.read_csv(ROOT / "data/processed/depth_chart_roles.csv", dtype={"gsis_id": "string"})
    sleeper = {} if args.offline else sleeper_api_by_id(2026, 1)
    audit = build_audit(projections, identities, depth, sleeper)
    duplicates = depth.groupby(["gsis_id", "season", "team"]).size().loc[lambda rows: rows.gt(1)]
    result = {
        "rows": int(len(audit)),
        "team_conflicts": int(audit.team_conflict.sum()),
        "missing_depth": int(audit.missing_depth.sum()),
        "duplicate_source_keys": int(len(duplicates)),
        "latest_source_updated_at": str(pd.to_datetime(depth.source_updated_at, errors="coerce", utc=True).max()),
        "latest_fetched_at": str(pd.to_datetime(depth.fetched_at, errors="coerce", utc=True).max()),
        "conflicts": audit.loc[audit.team_conflict].replace({pd.NA: None}).to_dict("records"),
        "players": audit.replace({pd.NA: None}).to_dict("records"),
    }
    OUTPUT.write_text(json.dumps(result, indent=2, default=str) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key not in {"players", "conflicts"}}, indent=2))
    print(f"Report: {OUTPUT}")


if __name__ == "__main__":
    main()
