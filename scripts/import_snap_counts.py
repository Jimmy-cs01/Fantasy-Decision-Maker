#!/usr/bin/env python3
"""Idempotently backfill trusted nflverse/PFR snap fields into weekly stats."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

if __package__:
    from .import_historical_data import SupabaseRest, batched, load_local_environment
else:
    from import_historical_data import SupabaseRest, batched, load_local_environment

ROOT = Path(__file__).resolve().parents[1]
SNAPS = ROOT / "data/processed/player_weekly_snap_statistics.csv.gz"
WEEKLY = ROOT / "data/processed/historical_weekly_player_stats.csv"
MATCH_KEYS = ["player_id", "season", "week", "season_type", "team"]
PAYLOAD_KEYS = [*MATCH_KEYS, "game_id"]


def build_backfill(snaps: pd.DataFrame, weekly: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int | float]]:
    required = set(MATCH_KEYS + ["offensive_snaps", "team_offensive_snaps", "offensive_snap_pct"])
    missing = required - set(snaps.columns)
    if missing:
        raise ValueError(f"Snap input is missing required fields: {sorted(missing)}")
    if snaps.duplicated(MATCH_KEYS).any() or weekly.duplicated(MATCH_KEYS).any():
        raise ValueError("Duplicate logical player-week identity blocks snap backfill.")
    matched = weekly[PAYLOAD_KEYS].merge(
        snaps[MATCH_KEYS + ["offensive_snaps", "team_offensive_snaps", "offensive_snap_pct"]],
        on=MATCH_KEYS, how="inner", validate="one_to_one",
    )
    if not matched.offensive_snap_pct.between(0, 1).all():
        raise ValueError("Snap percentages must use the canonical 0–1 scale.")
    if (matched.offensive_snaps > matched.team_offensive_snaps).any():
        raise ValueError("Player offensive snaps cannot exceed team offensive snaps.")
    stats_window = weekly.season.between(int(snaps.season.min()), int(snaps.season.max()))
    report = {
        "source_rows": int(len(snaps)), "eligible_weekly_rows": int(stats_window.sum()),
        "matched_rows": int(len(matched)), "unmatched_snap_rows": int(len(snaps) - len(matched)),
        "coverage_pct": round(100 * len(matched) / max(1, int(stats_window.sum())), 4),
        "duplicates": 0,
    }
    return matched, report


def payloads(frame: pd.DataFrame, player_ids: dict[str, str]) -> list[dict]:
    rows = []
    for row in frame.itertuples(index=False):
        internal = player_ids.get(str(row.player_id))
        if not internal:
            continue
        rows.append({
            "player_id": internal, "season": int(row.season), "week": int(row.week),
            "season_type": str(row.season_type), "team": str(row.team),
            "offense_snaps": int(row.offensive_snaps), "team_offense_snaps": int(row.team_offensive_snaps),
            "offense_snap_percentage": float(row.offensive_snap_pct),
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    snaps = pd.read_csv(SNAPS, dtype={"player_id": "string", "team": "string", "game_id": "string"})
    weekly = pd.read_csv(WEEKLY, dtype={"player_id": "string", "team": "string", "game_id": "string"}, low_memory=False)
    matched, report = build_backfill(snaps, weekly)
    print(json.dumps(report, indent=2))
    print(f"Safe to apply: {'YES' if report['duplicates'] == 0 else 'NO'}")
    if not args.apply:
        print("Dry run: no remote writes performed. Pass --apply after review.")
        return
    load_local_environment()
    import os
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    client = SupabaseRest(url, key)
    players = client.fetch_all_players()
    by_gsis = {str(row["gsis_id"]): str(row["id"]) for row in players if row.get("gsis_id")}
    rows = payloads(matched, by_gsis)
    missing_identity = len(matched) - len(rows)
    if missing_identity:
        raise SystemExit(f"Safe to apply: NO — {missing_identity} matched snap rows lack canonical player UUIDs.")
    for number, batch in batched(rows, args.batch_size):
        updated = client.request("POST", "/rpc/update_player_weekly_snap_counts", {"records": batch})
        if int(updated or 0) != len(batch):
            raise RuntimeError(
                f"Safe to apply: NO — snap batch {number} matched {updated} remote rows; expected {len(batch)}."
            )
        print(f"Snap batch {number} updated ({len(batch):,} rows)")
    print(f"Applied {len(rows):,} snap backfills without replacing other weekly statistics.")


if __name__ == "__main__":
    main()
