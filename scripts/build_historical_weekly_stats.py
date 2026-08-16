"""Normalize raw Kaggle weekly offensive stats without importing into Supabase.

The output retains GSIS/Kaggle player_id as its historical external identity. A
Sleeper ID is included only as an optional lookup/debug field, never as the key.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

SOURCE_FILE = Path("data/weekly_player_stats_offense.csv")
MAPPING_FILE = Path("data/player_id_mapping.csv")
PROCESSED_DIR = Path("data/processed")
IDENTITY_OUTPUT = PROCESSED_DIR / "player_identity.csv"
WEEKLY_OUTPUT = PROCESSED_DIR / "historical_weekly_player_stats.csv"
IDENTITY_COLUMNS = ["player_id", "pfr_player_id", "player_name", "historical_position", "position_group", "historical_team", "birth_date", "height", "weight", "college_name", "rookie_season", "sleeper_player_id", "sleeper_name", "sleeper_position", "sleeper_fantasy_positions", "sleeper_current_team", "match_score", "match_method", "confidence"]
WEEKLY_COLUMNS = [
    "player_id", "season", "week", "season_type", "game_id", "team",
    "pass_attempts", "complete_pass", "passing_yards", "passing_air_yards", "comp_pct", "ypa", "pass_adot", "passer_rating", "pass_touchdown", "pass_td_pct", "interception", "int_pct", "first_down_pass", "times_sacked", "times_pressured", "times_pressured_pct",
    "targets", "receptions", "receiving_yards", "receiving_air_yards", "yards_after_catch", "yptarget", "ypr", "rec_adot", "receiving_touchdown", "rec_td_pct",
    "rush_attempts", "rush_attempts_red_zone", "rush_attempts_gtg", "rushing_yards", "ypc", "rush_touchdown", "rush_touchdown_red_zone", "rush_touchdown_gtg", "rush_td_pct", "first_down_rush",
    "offense_snaps", "team_offense_snaps", "offense_pct", "touches", "total_yards", "total_tds",
    "fantasy_points_standard", "fantasy_points_half_ppr", "fantasy_points_ppr",
]
LOGICAL_KEY = ["player_id", "season", "week", "season_type", "game_id"]
NUMERIC_COLUMNS = [column for column in WEEKLY_COLUMNS if column not in {"player_id", "season_type", "game_id", "team"}]


def validate_required_columns(frame: pd.DataFrame, columns: list[str], source: str) -> None:
    missing = sorted(set(columns) - set(frame.columns))
    if missing:
        raise ValueError(f"{source} is missing required columns: {', '.join(missing)}")


def validate_weekly_stats(frame: pd.DataFrame) -> int:
    validate_required_columns(frame, WEEKLY_COLUMNS, "weekly stats")
    if frame[["player_id", "season", "week"]].isna().any().any() or frame[["player_id", "season", "week"]].astype("string").eq("").any().any():
        raise ValueError("Weekly stats contains null player_id, season, or week values.")
    if not frame["season"].between(1920, 2100).all() or not frame["week"].between(1, 30).all():
        raise ValueError("Weekly stats contains invalid season or week values.")
    duplicates = frame.duplicated(LOGICAL_KEY, keep=False)
    duplicate_count = int(duplicates.sum())
    if duplicate_count:
        sample = frame.loc[duplicates, LOGICAL_KEY].head().to_string(index=False)
        raise ValueError(f"Found {duplicate_count} duplicate weekly records. No rows were dropped. Sample:\n{sample}")
    return duplicate_count


def load_mapping() -> pd.DataFrame:
    mapping = pd.read_csv(MAPPING_FILE, dtype={"player_id": "string", "sleeper_player_id": "string"}, keep_default_na=False)
    validate_required_columns(mapping, IDENTITY_COLUMNS, "player mapping")
    if mapping["player_id"].duplicated().any():
        raise ValueError("Player mapping contains duplicate player_id values.")
    if mapping["sleeper_player_id"].str.endswith(".0").any():
        raise ValueError("Player mapping contains float-formatted Sleeper IDs.")
    return mapping[IDENTITY_COLUMNS].copy()


def build_weekly_frame() -> pd.DataFrame:
    # usecols is critical: the source CSV contains hundreds of derived feature columns.
    weekly = pd.read_csv(SOURCE_FILE, usecols=WEEKLY_COLUMNS, dtype={"player_id": "string", "game_id": "string", "season_type": "string", "team": "string"}, low_memory=False)
    validate_required_columns(weekly, WEEKLY_COLUMNS, "weekly source")
    weekly["player_id"] = weekly["player_id"].astype("string")
    for column in NUMERIC_COLUMNS:
        weekly[column] = pd.to_numeric(weekly[column], errors="coerce")
    weekly["season"] = weekly["season"].astype("Int64")
    weekly["week"] = weekly["week"].astype("Int64")
    weekly["season_type"] = weekly["season_type"].astype("string").str.upper()
    weekly["team"] = weekly["team"].astype("string")
    weekly["game_id"] = weekly["game_id"].astype("string")
    return weekly


def main() -> None:
    mapping = load_mapping()
    print("Loading required raw weekly-stat columns...")
    weekly = build_weekly_frame()
    duplicate_count = validate_weekly_stats(weekly)
    enriched = weekly.merge(mapping[["player_id", "sleeper_player_id"]], on="player_id", how="left", validate="many_to_one")
    # Keep canonical player_id first; Sleeper is an optional provider mapping only.
    enriched["sleeper_player_id"] = enriched["sleeper_player_id"].fillna("").astype("string")
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    mapping.to_csv(IDENTITY_OUTPUT, index=False, na_rep="")
    enriched.to_csv(WEEKLY_OUTPUT, index=False, na_rep="")
    print("\n========== HISTORICAL WEEKLY ETL ==========")
    print(f"Weekly rows produced:       {len(enriched):,}")
    print(f"Duplicate rows found:       {duplicate_count:,}")
    print(f"Historical seasons:         {', '.join(map(str, sorted(enriched['season'].dropna().unique())))}")
    print(f"Rows with Sleeper mapping:  {enriched['sleeper_player_id'].ne('').sum():,}")
    print(f"Identity output: {IDENTITY_OUTPUT}")
    print(f"Weekly output:   {WEEKLY_OUTPUT}")


if __name__ == "__main__":
    main()
