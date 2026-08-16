"""Discover and download official nflverse weekly player-stat CSV assets."""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

RELEASE_API = "https://api.github.com/repos/nflverse/nflverse-data/releases/tags/stats_player"
OUTPUT_DIR = Path("data/nflverse")
ASSET_PATTERN = re.compile(r"^stats_player_week_(\d{4})\.csv$")
MIN_FILE_BYTES = 10_000
DEFAULT_START_SEASON = 2012
REQUIRED_COLUMNS = {
    "player_id", "player_display_name", "position", "season", "week", "season_type",
    "team", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
    "carries", "rushing_yards", "rushing_tds", "targets", "receptions",
    "receiving_yards", "receiving_tds", "fantasy_points", "fantasy_points_ppr",
}


def request_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "jims-fantasy-helper-etl"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def discover_assets() -> dict[int, str]:
    release = request_json(RELEASE_API)
    assets = {}
    for asset in release.get("assets", []):
        match = ASSET_PATTERN.match(str(asset.get("name", "")))
        if match:
            assets[int(match.group(1))] = str(asset["browser_download_url"])
    if not assets:
        raise RuntimeError("The official nflverse stats_player release contained no weekly CSV assets.")
    seasons = sorted(assets)
    missing = sorted(set(range(seasons[0], seasons[-1] + 1)) - set(seasons))
    if missing:
        raise RuntimeError(f"The official weekly player-stat release has a season gap: {missing}")
    return assets


def validate_source_file(path: Path, expected_season: int) -> None:
    if not path.is_file():
        raise ValueError(f"Missing source file: {path}")
    if path.stat().st_size < MIN_FILE_BYTES:
        raise ValueError(f"{path} is only {path.stat().st_size:,} bytes and is not a valid nflverse CSV.")
    try:
        header = pd.read_csv(path, nrows=0)
    except Exception as error:
        raise ValueError(f"{path} is not a parseable CSV: {error}") from error
    missing = sorted(REQUIRED_COLUMNS - set(header.columns))
    if missing:
        raise ValueError(f"{path} is missing required columns: {', '.join(missing)}")
    identity = pd.read_csv(path, usecols=["player_id", "position", "season", "week", "season_type"], dtype={"player_id": "string", "position": "string", "season_type": "string"})
    seasons = set(pd.to_numeric(identity["season"], errors="raise").astype(int).unique())
    if seasons != {expected_season}:
        raise ValueError(f"{path} must contain only season {expected_season}; found {sorted(seasons)}")
    if identity[["week", "season_type"]].isna().any().any():
        raise ValueError(f"{path} contains null week or season_type values.")
    fantasy = identity["position"].str.upper().isin({"QB", "RB", "WR", "TE"})
    if identity.loc[fantasy, "player_id"].isna().any():
        raise ValueError(f"{path} contains a fantasy-position row with a null player_id.")


def download_asset(url: str, target: Path, season: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"Accept": "text/csv", "User-Agent": "jims-fantasy-helper-etl"})
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=f".{target.name}.", delete=False) as temporary:
        temporary_path = Path(temporary.name)
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                content_type = response.headers.get("Content-Type", "").lower()
                if "text/html" in content_type:
                    raise RuntimeError(f"Refusing HTML response for {target.name}.")
                while chunk := response.read(1024 * 1024):
                    temporary.write(chunk)
        except Exception:
            temporary_path.unlink(missing_ok=True)
            raise
    try:
        validate_source_file(temporary_path, season)
        os.replace(temporary_path, target)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-season", type=int)
    parser.add_argument("--end-season", type=int)
    parser.add_argument("--replace-invalid", action="store_true", help="Redownload an existing file that fails validation.")
    parser.add_argument("--dry-run", action="store_true", help="Discover and validate without downloading files.")
    args = parser.parse_args()
    assets = discover_assets()
    discovered = sorted(assets)
    first = args.start_season or DEFAULT_START_SEASON
    last = args.end_season or discovered[-1]
    requested = list(range(first, last + 1))
    unavailable = sorted(set(requested) - set(assets))
    if unavailable:
        raise RuntimeError(f"Requested seasons are not available in the official nflverse release: {unavailable}")
    downloaded = skipped = invalid = 0
    for season in requested:
        target = OUTPUT_DIR / f"stats_player_week_{season}.csv"
        if target.exists():
            try:
                validate_source_file(target, season)
                skipped += 1
                print(f"VALID {season}: {target}")
                continue
            except ValueError as error:
                invalid += 1
                if not args.replace_invalid:
                    raise RuntimeError(f"{error} Re-run with --replace-invalid to replace it.") from error
        if args.dry_run:
            print(f"MISSING {season}: would download {assets[season]}")
            continue
        print(f"DOWNLOAD {season}: {assets[season]}")
        download_asset(assets[season], target, season)
        downloaded += 1
    print("\n========== NFLVERSE DOWNLOAD ==========")
    print(f"Official weekly range: {discovered[0]}–{discovered[-1]} ({len(discovered)} seasons)")
    print(f"Requested range:       {first}–{last}")
    print(f"Downloaded:            {downloaded}")
    print(f"Existing valid:        {skipped}")
    print(f"Invalid replaced:      {invalid if args.replace_invalid else 0}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, urllib.error.URLError) as error:
        raise SystemExit(f"Download failed: {error}")
