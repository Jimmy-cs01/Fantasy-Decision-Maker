#!/usr/bin/env python3
"""Download official nflverse PBP season assets without loading them into memory."""
from __future__ import annotations

import argparse
import gzip
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path

if __package__:
    from .projection_pipeline.v3_config import (
        PBP_END_SEASON, PBP_RAW_DIR, PBP_SOURCE_TEMPLATE, PBP_START_SEASON,
    )
else:
    from projection_pipeline.v3_config import (
        PBP_END_SEASON, PBP_RAW_DIR, PBP_SOURCE_TEMPLATE, PBP_START_SEASON,
    )

REQUIRED_HEADER_FIELDS = {
    "game_id", "season", "week", "posteam", "defteam", "play_type",
    "rusher_player_id", "receiver_player_id", "passer_player_id", "epa",
}


def validate_asset(path: Path) -> None:
    if not path.exists() or path.stat().st_size < 1_000_000:
        raise ValueError(f"{path} is too small to be a valid nflverse PBP asset")
    with gzip.open(path, "rt", encoding="utf-8") as source:
        header = set(source.readline().strip().split(","))
    missing = sorted(REQUIRED_HEADER_FIELDS - header)
    if missing:
        raise ValueError(f"{path} is missing required nflverse PBP columns: {missing}")


def download_asset(season: int, destination: Path, retries: int = 3) -> None:
    url = PBP_SOURCE_TEMPLATE.format(season=season)
    temporary = destination.with_suffix(destination.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "JimmyGM-ModelV3/1.0"})
            with urllib.request.urlopen(request, timeout=30) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output)
            validate_asset(temporary)
            temporary.replace(destination)
            return
        except (OSError, urllib.error.URLError, ValueError) as error:
            temporary.unlink(missing_ok=True)
            if attempt == retries:
                raise RuntimeError(f"Unable to download nflverse PBP for {season}: {error}") from error
            time.sleep(2 ** (attempt - 1))


def main() -> None:
    parser = argparse.ArgumentParser(description="Download official nflverse play-by-play CSV assets.")
    parser.add_argument("--start-season", type=int, default=PBP_START_SEASON)
    parser.add_argument("--end-season", type=int, default=PBP_END_SEASON)
    parser.add_argument("--output-dir", type=Path, default=PBP_RAW_DIR)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.start_season < 1999 or args.end_season < args.start_season:
        raise ValueError("Invalid nflverse PBP season range")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    for season in range(args.start_season, args.end_season + 1):
        path = args.output_dir / f"play_by_play_{season}.csv.gz"
        if path.exists() and not args.force:
            validate_asset(path)
            print(f"PBP {season}: already present ({path.stat().st_size / 1_000_000:.1f} MB)")
        else:
            download_asset(season, path)
            print(f"PBP {season}: downloaded ({path.stat().st_size / 1_000_000:.1f} MB)")
        total_bytes += path.stat().st_size
    print(f"Validated {args.end_season - args.start_season + 1} seasons; {total_bytes / 1_000_000:.1f} MB compressed.")
    print(f"Output: {args.output_dir}")


if __name__ == "__main__":
    main()
