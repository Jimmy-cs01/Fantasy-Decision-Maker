#!/usr/bin/env python3
from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

import pandas as pd

if __package__:
    from .projection_pipeline.config import SCHEDULE_OUTPUT_PATH, SCHEDULE_SOURCE_URL
    from .projection_pipeline.schedules import SCHEDULE_SOURCE_COLUMNS, normalize_schedules
else:
    from projection_pipeline.config import SCHEDULE_OUTPUT_PATH, SCHEDULE_SOURCE_URL
    from projection_pipeline.schedules import SCHEDULE_SOURCE_COLUMNS, normalize_schedules


def download(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "Jimmy-GM/1.0"})
    with urlopen(request, timeout=90) as response:
        return response.read()


def main() -> None:
    parser = argparse.ArgumentParser(description="Download and normalize the official nflverse NFL schedule.")
    parser.add_argument("--source", help="Optional local games.csv; otherwise downloads nflverse.")
    parser.add_argument("--output", type=Path, default=SCHEDULE_OUTPUT_PATH)
    parser.add_argument("--start-season", type=int, default=2012)
    args = parser.parse_args()
    wanted = set(SCHEDULE_SOURCE_COLUMNS)
    source = pd.read_csv(args.source, usecols=lambda column: column in wanted) if args.source else pd.read_csv(
        BytesIO(download(SCHEDULE_SOURCE_URL)), usecols=lambda column: column in wanted
    )
    normalized = normalize_schedules(source, args.start_season)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    normalized.to_csv(args.output, index=False)
    seasons = sorted(normalized.season.unique())
    print(f"Wrote {len(normalized):,} team-game schedule rows ({seasons[0]}–{seasons[-1]}).")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
