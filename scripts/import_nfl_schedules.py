#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

if __package__:
    from .import_player_projections import SupabaseRest, chunks, load_local_environment
else:
    from import_player_projections import SupabaseRest, chunks, load_local_environment

REQUIRED = {"game_id", "season", "week", "season_type", "team", "opponent_team", "is_home", "neutral_site", "kickoff"}


def build_games(frame: pd.DataFrame) -> list[dict]:
    missing = sorted(REQUIRED - set(frame.columns))
    if missing:
        raise ValueError(f"Normalized schedule is missing columns: {missing}")
    games: list[dict] = []
    for game_id, rows in frame.groupby("game_id", sort=True):
        home = rows.loc[rows["is_home"].eq(1)]
        away = rows.loc[rows["is_home"].eq(0)]
        if len(home) != 1 or len(away) != 1:
            raise ValueError(f"Schedule game {game_id} does not contain exactly one home and away row")
        row = home.iloc[0]
        kickoff = None if pd.isna(row["kickoff"]) else pd.Timestamp(row["kickoff"]).isoformat()
        games.append({
            "nflverse_game_id": str(game_id),
            "season": int(row["season"]),
            "week": int(row["week"]),
            "season_type": str(row["season_type"]),
            "kickoff": kickoff,
            "home_team": str(row["team"]),
            "away_team": str(away.iloc[0]["team"]),
            "neutral_site": bool(row["neutral_site"]),
        })
    return games


def main() -> None:
    parser = argparse.ArgumentParser(description="Import normalized nflverse schedules into canonical NFL games.")
    parser.add_argument("--input", type=Path, default=Path("data/processed/schedules.csv"))
    parser.add_argument("--season", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    frame = pd.read_csv(args.input, dtype={"game_id": "string", "team": "string", "opponent_team": "string"})
    if args.season is not None:
        frame = frame.loc[frame["season"].eq(args.season)].copy()
    games = build_games(frame)
    if args.dry_run:
        print(f"Validated {len(games):,} canonical NFL games; no remote writes performed.")
        return
    load_local_environment()
    client = SupabaseRest()
    for number, batch in enumerate(chunks(games), start=1):
        client.request(
            "POST",
            "nfl_games?on_conflict=nflverse_game_id",
            batch,
            "resolution=merge-duplicates,return=minimal",
        )
        print(f"Schedule batch {number} upserted ({len(batch)} games)")
    print(f"Imported {len(games):,} canonical NFL games.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Schedule import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
