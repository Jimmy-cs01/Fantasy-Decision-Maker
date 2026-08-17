#!/usr/bin/env python3
from __future__ import annotations

import argparse

if __package__:
    from .projection_pipeline.config import FEATURE_DATASET_PATH, HISTORICAL_STATS_PATH, SCHEDULE_OUTPUT_PATH
    from .projection_pipeline.features import build_modeling_dataset, read_historical_stats
    from .projection_pipeline.schedules import read_normalized_schedule
else:
    from projection_pipeline.config import FEATURE_DATASET_PATH, HISTORICAL_STATS_PATH, SCHEDULE_OUTPUT_PATH
    from projection_pipeline.features import build_modeling_dataset, read_historical_stats
    from projection_pipeline.schedules import read_normalized_schedule


def main() -> None:
    parser = argparse.ArgumentParser(description="Build leakage-safe pregame player-week features.")
    parser.add_argument("--input", type=str, default=str(HISTORICAL_STATS_PATH))
    parser.add_argument("--output", type=str, default=str(FEATURE_DATASET_PATH))
    parser.add_argument("--schedule", type=str, default=str(SCHEDULE_OUTPUT_PATH))
    parser.add_argument("--without-schedule", action="store_true", help="Build without matchup context.")
    args = parser.parse_args()
    from pathlib import Path

    source, output = Path(args.input), Path(args.output)
    schedule = None if args.without_schedule else read_normalized_schedule(Path(args.schedule))
    frame = build_modeling_dataset(read_historical_stats(source), schedule)
    output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output, index=False)
    first, last = int(frame.season.min()), int(frame.season.max())
    matched = int(frame["is_home"].notna().sum())
    print(f"Built {len(frame):,} leakage-safe player-week rows ({first}–{last}); {matched:,} schedule matched.")
    print(f"Output: {output}")


if __name__ == "__main__":
    main()
