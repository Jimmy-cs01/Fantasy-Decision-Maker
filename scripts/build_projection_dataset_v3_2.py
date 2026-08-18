#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

if __package__:
    from .projection_pipeline.v3_2_config import SNAP_WEEKLY_PATH, V3_2_FEATURE_DATASET_PATH
    from .projection_pipeline.v3_2_features import attach_shifted_snap_features, read_snap_weekly
    from .projection_pipeline.v3_config import V3_FEATURE_DATASET_PATH
else:
    from projection_pipeline.v3_2_config import SNAP_WEEKLY_PATH, V3_2_FEATURE_DATASET_PATH
    from projection_pipeline.v3_2_features import attach_shifted_snap_features, read_snap_weekly
    from projection_pipeline.v3_config import V3_FEATURE_DATASET_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description="Build leakage-safe Model v3.2 features from v3.1/PBP plus official snaps.")
    parser.add_argument("--base", type=Path, default=V3_FEATURE_DATASET_PATH)
    parser.add_argument("--snaps", type=Path, default=SNAP_WEEKLY_PATH)
    parser.add_argument("--output", type=Path, default=V3_2_FEATURE_DATASET_PATH)
    args = parser.parse_args()
    base = pd.read_csv(args.base, dtype={"player_id": "string", "team": "string"})
    snaps = read_snap_weekly(args.snaps)
    output = attach_shifted_snap_features(base, snaps)
    identity = ["player_id", "season", "week", "season_type", "game_id"]
    if output.duplicated(identity).any():
        raise ValueError("v3.2 feature dataset contains duplicate player-weeks")
    # Current-game snap values are retained only for audit/target construction;
    # the model feature lists contain shifted fields exclusively.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False, compression="gzip")
    matched = int(output["snap_source_row"].fillna(0).sum())
    prior = int(output["snap_pct_last_1"].notna().sum())
    print(f"Built {len(output):,} v3.2 player-weeks; current snap rows matched: {matched:,}; rows with prior snaps: {prior:,}.")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()

