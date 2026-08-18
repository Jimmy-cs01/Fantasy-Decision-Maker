#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

DEFAULT_PATH = Path("data/processed/player_projections_v3_1.csv")


def main() -> None:
    parser = argparse.ArgumentParser(description="Explain a local Model v3.1 current-player projection.")
    parser.add_argument("--player", required=True)
    parser.add_argument("--input", type=Path, default=DEFAULT_PATH)
    args = parser.parse_args()
    frame = pd.read_csv(args.input, dtype={"gsis_id": "string"})
    matches = frame.loc[frame["player_name"].fillna("").str.contains(args.player, case=False, regex=False)]
    if matches.empty:
        raise SystemExit(f"No v3.1 projection found for {args.player!r}")
    for _, row in matches.iterrows():
        stats = json.loads(row["projected_stats"])
        print(f"{row.player_name} ({row.position}, {row.team or 'FA'})")
        print(f"  History: {row.history_category}; sample weight {row.sample_weight:.3f}")
        print(f"  Current role: {row.depth_position or 'unknown'}{int(row.depth_rank) if pd.notna(row.depth_rank) else ''}; confidence {row.role_confidence:.3f}")
        print(f"  Expected opportunity: {row.expected_pass_attempts:.2f} pass attempts, {row.expected_rush_attempts:.2f} carries, {row.expected_targets:.2f} targets")
        print(f"  Efficiency/stat line: {json.dumps(stats, sort_keys=True)}")
        print(f"  Direct model: {row.direct_projection_ppr:.3f}; pure v3.1: {row.pure_v3_1_projection_ppr:.3f}; frozen {row.frozen_candidate}: {row.model_projection_ppr:.3f}")


if __name__ == "__main__":
    main()

