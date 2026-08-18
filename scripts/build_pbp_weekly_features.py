#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

if __package__:
    from .projection_pipeline.config import HISTORICAL_STATS_PATH
    from .projection_pipeline.features import read_historical_stats
    from .projection_pipeline.pbp import aggregate_pbp, finalize_player_features, read_pbp
    from .projection_pipeline.v3_config import (
        PBP_END_SEASON, PBP_RAW_DIR, PBP_START_SEASON, PBP_WEEKLY_PATH,
    )
else:
    from projection_pipeline.config import HISTORICAL_STATS_PATH
    from projection_pipeline.features import read_historical_stats
    from projection_pipeline.pbp import aggregate_pbp, finalize_player_features, read_pbp
    from projection_pipeline.v3_config import (
        PBP_END_SEASON, PBP_RAW_DIR, PBP_START_SEASON, PBP_WEEKLY_PATH,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build compact weekly advanced player features from nflverse PBP.")
    parser.add_argument("--start-season", type=int, default=PBP_START_SEASON)
    parser.add_argument("--end-season", type=int, default=PBP_END_SEASON)
    parser.add_argument("--input-dir", type=Path, default=PBP_RAW_DIR)
    parser.add_argument("--historical", type=Path, default=HISTORICAL_STATS_PATH)
    parser.add_argument("--output", type=Path, default=PBP_WEEKLY_PATH)
    args = parser.parse_args()

    historical = read_historical_stats(args.historical)
    frames: list[pd.DataFrame] = []
    reports: list[dict] = []
    raw_bytes = 0
    generated_at = datetime.now(UTC).isoformat()
    for season in range(args.start_season, args.end_season + 1):
        path = args.input_dir / f"play_by_play_{season}.csv.gz"
        if not path.exists():
            raise FileNotFoundError(f"Missing {path}. Run: npm run data:pbp")
        raw_bytes += path.stat().st_size
        player, _team = aggregate_pbp(read_pbp(path))
        weekly, report = finalize_player_features(
            player,
            historical.loc[historical["season"].eq(season)],
        )
        weekly["source_season"] = season
        weekly["generated_at"] = generated_at
        frames.append(weekly)
        reports.append({"season": season, **report})
        print(
            f"PBP {season}: {len(weekly):,} fantasy player-weeks; "
            f"{report['unmapped_player_weeks']:,} player-weeks lacked fantasy identity context."
        )

    output = pd.concat(frames, ignore_index=True)
    duplicate_key = ["player_id", "season", "week", "season_type", "game_id", "team"]
    duplicates = output.duplicated(duplicate_key, keep=False)
    if duplicates.any():
        raise ValueError(f"PBP aggregation produced {int(duplicates.sum())} duplicate player-game rows")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False, compression="gzip")
    report_path = args.output.with_suffix(".report.json")
    report_path.write_text(json.dumps({
        "source": "nflverse/pbp",
        "seasons": [args.start_season, args.end_season],
        "compressed_source_bytes": raw_bytes,
        "generated_at": generated_at,
        "rows": len(output),
        "season_reports": reports,
    }, indent=2) + "\n")
    print(f"Wrote {len(output):,} advanced player-weeks ({raw_bytes / 1_000_000:.1f} MB raw compressed input).")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
