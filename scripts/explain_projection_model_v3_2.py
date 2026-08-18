#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def main() -> None:
    parser = argparse.ArgumentParser(description="Explain a local Model v3.2 snap-aware projection.")
    parser.add_argument("--player", required=True)
    parser.add_argument("--input", type=Path, default=Path("data/processed/model_v3_2_comparison.csv"))
    args = parser.parse_args()
    frame = pd.read_csv(args.input)
    matches = frame.loc[frame["player_name"].fillna("").str.contains(args.player, case=False, regex=False)]
    if matches.empty:
        raise SystemExit(f"No v3.2 projection found for {args.player!r}")
    for _, row in matches.iterrows():
        stats = json.loads(row["projected_stats"])
        print(f"{row.player_name} ({row.position}, {row.team if pd.notna(row.team) else 'FA'})")
        depth = f"{row.depth_position}{int(row.depth_rank)}" if pd.notna(row.depth_position) and pd.notna(row.depth_rank) else "unknown"
        print(f"  Depth: {depth}")
        print(f"  Snaps: last {row.recent_snap_pct if pd.notna(row.recent_snap_pct) else 'missing'}; rolling-3 {row.rolling_3_snap_pct if pd.notna(row.rolling_3_snap_pct) else 'missing'}; trend {row.snap_trend if pd.notna(row.snap_trend) else 'missing'}")
        print(f"  Snap-aware role confidence: {row.snap_role_confidence:.3f}")
        print(f"  Opportunity: {row.expected_pass_attempts:.2f} pass attempts, {row.expected_rush_attempts:.2f} carries, {row.expected_targets:.2f} targets")
        print(f"  Components: {json.dumps(stats, sort_keys=True)}")
        v2 = f"v2 {row.v2:.3f}; " if "v2" in row and pd.notna(row.v2) else ""
        print(f"  {v2}v3.1 {row.v3_1:.3f}; v3.2 {row.v3_2:.3f}; delta {row.difference_vs_v3_1:+.3f}")


if __name__ == "__main__":
    main()

