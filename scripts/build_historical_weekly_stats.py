"""Build the canonical historical player-stat dataset from nflverse weekly files.

nflverse/GSIS ``player_id`` remains the historical external identity. Existing
Sleeper mappings are reused by ID; names and teams are never used to rematch a
known GSIS identity. Generated files are import-ready but are not written to
Supabase by this script.
"""
from __future__ import annotations

from pathlib import Path
import re

import pandas as pd

NFLVERSE_DIR = Path("data/nflverse")
MAPPING_FILE = Path("data/player_id_mapping.csv")
PROCESSED_DIR = Path("data/processed")
IDENTITY_OUTPUT = PROCESSED_DIR / "player_identity.csv"
WEEKLY_OUTPUT = PROCESSED_DIR / "historical_weekly_player_stats.csv"
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE"}
SOURCE_COLUMNS = [
    "player_id", "player_display_name", "position", "position_group", "headshot_url", "season", "week",
    "season_type", "team", "opponent_team", "completions", "attempts", "passing_yards",
    "passing_tds", "passing_interceptions", "sacks_suffered", "passing_air_yards",
    "passing_first_downs", "passing_epa", "passing_cpoe", "pacr", "carries",
    "rushing_yards", "rushing_tds", "rushing_first_downs", "rushing_epa", "receptions",
    "targets", "receiving_yards", "receiving_tds", "receiving_air_yards",
    "receiving_yards_after_catch", "receiving_first_downs", "receiving_epa", "racr",
    "target_share", "air_yards_share", "wopr", "fantasy_points", "fantasy_points_ppr",
]
REQUIRED_SOURCE_COLUMNS = {
    "player_id", "player_display_name", "position", "season", "week", "season_type",
    "team", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
    "carries", "rushing_yards", "rushing_tds", "targets", "receptions",
    "receiving_yards", "receiving_tds", "fantasy_points", "fantasy_points_ppr",
}
SOURCE_FILE_PATTERN = re.compile(r"^stats_player_week_(\d{4})\.csv$")
MIN_SOURCE_BYTES = 10_000
FIRST_HISTORICAL_SEASON = 2012
MAPPING_IDENTITY_COLUMNS = [
    "player_id", "pfr_player_id", "player_name", "historical_position", "position_group",
    "historical_team", "birth_date", "height", "weight", "college_name", "rookie_season",
    "sleeper_player_id", "sleeper_name", "sleeper_position", "sleeper_fantasy_positions",
    "sleeper_current_team", "match_score", "match_method", "confidence",
]
IDENTITY_COLUMNS = [*MAPPING_IDENTITY_COLUMNS[:11], "headshot_url", *MAPPING_IDENTITY_COLUMNS[11:]]
WEEKLY_COLUMNS = [
    "player_id", "season", "week", "season_type", "game_id", "team", "opponent_team",
    "historical_position", "pass_attempts", "completions", "completion_percentage",
    "passing_yards", "passing_air_yards", "yards_per_attempt", "pass_adot",
    "passing_touchdowns", "interceptions_thrown", "passing_first_downs", "times_sacked",
    "passing_epa", "passing_cpoe", "pacr", "rush_attempts", "rushing_yards",
    "yards_per_carry", "rushing_touchdowns", "rushing_first_downs", "rushing_epa",
    "targets", "receptions", "receiving_yards", "receiving_air_yards", "yards_after_catch",
    "yards_per_target", "yards_per_reception", "receiving_adot", "receiving_touchdowns",
    "receiving_first_downs", "receiving_epa", "racr", "target_share", "air_yards_share",
    "wopr", "true_touches", "total_yards", "total_touchdowns", "fantasy_points_standard",
    "fantasy_points_half_ppr", "fantasy_points_ppr", "source", "source_dataset",
    "source_season",
]
LOGICAL_KEY = ["player_id", "season", "week", "season_type", "game_id"]
TEXT_COLUMNS = {
    "player_id", "season_type", "game_id", "team", "opponent_team", "historical_position",
    "source", "source_dataset",
}


def validate_required_columns(frame: pd.DataFrame, columns: list[str], source: str) -> None:
    missing = sorted(set(columns) - set(frame.columns))
    if missing:
        raise ValueError(f"{source} is missing required columns: {', '.join(missing)}")


def safe_divide(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    result = numerator.astype("Float64").div(denominator.astype("Float64"))
    return result.mask(denominator.eq(0))


def source_files() -> list[Path]:
    discovered = []
    for path in NFLVERSE_DIR.glob("stats_player_week_*.csv"):
        match = SOURCE_FILE_PATTERN.match(path.name)
        if match and int(match.group(1)) >= FIRST_HISTORICAL_SEASON:
            discovered.append((int(match.group(1)), path))
    if not discovered:
        raise ValueError(
            f"No nflverse weekly player-stat files were found for {FIRST_HISTORICAL_SEASON} or later. "
            "Run the downloader first."
        )
    discovered.sort()
    seasons = [season for season, _ in discovered]
    missing = sorted(set(range(seasons[0], seasons[-1] + 1)) - set(seasons))
    if missing:
        raise ValueError(f"Local nflverse weekly source range has missing seasons: {missing}")
    return [path for _, path in discovered]


def load_source_file(path: Path, expected_season: int) -> pd.DataFrame:
    if path.stat().st_size < MIN_SOURCE_BYTES:
        raise ValueError(f"{path} is too small to be a valid nflverse weekly CSV.")
    try:
        header = pd.read_csv(path, nrows=0)
        validate_required_columns(header, sorted(REQUIRED_SOURCE_COLUMNS), str(path))
        available_columns = [column for column in SOURCE_COLUMNS if column in header.columns]
        frame = pd.read_csv(
            path,
            usecols=available_columns,
            dtype={"player_id": "string", "season_type": "string", "team": "string", "opponent_team": "string"},
            low_memory=False,
        )
    except ValueError as error:
        raise ValueError(f"{path} is not a valid nflverse weekly player-stat file: {error}") from error
    for column in SOURCE_COLUMNS:
        if column not in frame.columns:
            frame[column] = pd.NA
    seasons = set(pd.to_numeric(frame["season"], errors="raise").astype(int).unique())
    if seasons != {expected_season}:
        raise ValueError(f"{path} must contain only season {expected_season}; found {sorted(seasons)}")
    if frame[["week", "season_type"]].isna().any().any():
        raise ValueError(f"{path} contains null week or season_type values.")
    return frame


def load_nflverse() -> pd.DataFrame:
    paths = source_files()
    frames = [load_source_file(path, int(SOURCE_FILE_PATTERN.match(path.name).group(1))) for path in paths]
    source = pd.concat(frames, ignore_index=True)
    source["position"] = source["position"].astype("string").str.upper()
    source = source[source["position"].isin(FANTASY_POSITIONS)].copy()
    if source["player_id"].isna().any() or source["player_id"].str.strip().eq("").any():
        raise ValueError("Fantasy-position nflverse rows contain a missing player_id.")
    return source


def make_game_id(frame: pd.DataFrame) -> pd.Series:
    team = frame["team"].fillna("UNK").astype("string")
    opponent = frame["opponent_team"].fillna("UNK").astype("string")
    week = frame["week"].astype(int).astype(str).str.zfill(2)
    return "nflverse:" + frame["season"].astype(int).astype(str) + ":" + frame["season_type"] + ":" + week + ":" + team + ":" + opponent


def normalize_weekly(source: pd.DataFrame) -> pd.DataFrame:
    frame = pd.DataFrame(index=source.index)
    direct = {
        "player_id": "player_id", "season": "season", "week": "week", "season_type": "season_type",
        "team": "team", "opponent_team": "opponent_team", "position": "historical_position",
        "attempts": "pass_attempts", "completions": "completions", "passing_yards": "passing_yards",
        "passing_air_yards": "passing_air_yards", "passing_tds": "passing_touchdowns",
        "passing_interceptions": "interceptions_thrown", "passing_first_downs": "passing_first_downs",
        "sacks_suffered": "times_sacked", "passing_epa": "passing_epa", "passing_cpoe": "passing_cpoe",
        "pacr": "pacr", "carries": "rush_attempts", "rushing_yards": "rushing_yards",
        "rushing_tds": "rushing_touchdowns", "rushing_first_downs": "rushing_first_downs",
        "rushing_epa": "rushing_epa", "targets": "targets", "receptions": "receptions",
        "receiving_yards": "receiving_yards", "receiving_air_yards": "receiving_air_yards",
        "receiving_yards_after_catch": "yards_after_catch", "receiving_tds": "receiving_touchdowns",
        "receiving_first_downs": "receiving_first_downs", "receiving_epa": "receiving_epa",
        "racr": "racr", "target_share": "target_share", "air_yards_share": "air_yards_share",
        "wopr": "wopr", "fantasy_points": "fantasy_points_standard",
        "fantasy_points_ppr": "fantasy_points_ppr",
    }
    for source_name, canonical_name in direct.items():
        frame[canonical_name] = source[source_name]
    frame["season"] = pd.to_numeric(frame["season"], errors="raise").astype("Int64")
    frame["week"] = pd.to_numeric(frame["week"], errors="raise").astype("Int64")
    frame["season_type"] = frame["season_type"].astype("string").str.upper()
    frame["game_id"] = make_game_id(frame)
    numeric = [column for column in frame.columns if column not in TEXT_COLUMNS]
    for column in numeric:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["completion_percentage"] = safe_divide(frame["completions"], frame["pass_attempts"])
    frame["yards_per_attempt"] = safe_divide(frame["passing_yards"], frame["pass_attempts"])
    frame["pass_adot"] = safe_divide(frame["passing_air_yards"], frame["pass_attempts"])
    frame["yards_per_carry"] = safe_divide(frame["rushing_yards"], frame["rush_attempts"])
    frame["yards_per_target"] = safe_divide(frame["receiving_yards"], frame["targets"])
    frame["yards_per_reception"] = safe_divide(frame["receiving_yards"], frame["receptions"])
    frame["receiving_adot"] = safe_divide(frame["receiving_air_yards"], frame["targets"])
    frame["true_touches"] = frame["rush_attempts"].fillna(0) + frame["receptions"].fillna(0)
    is_qb = frame["historical_position"].eq("QB")
    frame["total_yards"] = (frame["rushing_yards"].fillna(0) + frame["receiving_yards"].fillna(0)).where(
        ~is_qb, frame["passing_yards"].fillna(0) + frame["rushing_yards"].fillna(0)
    )
    frame["total_touchdowns"] = (frame["rushing_touchdowns"].fillna(0) + frame["receiving_touchdowns"].fillna(0)).where(
        ~is_qb, frame["passing_touchdowns"].fillna(0) + frame["rushing_touchdowns"].fillna(0)
    )
    frame["fantasy_points_half_ppr"] = frame["fantasy_points_standard"] + 0.5 * frame["receptions"]
    frame["source"] = "nflverse"
    frame["source_dataset"] = "player_stats"
    frame["source_season"] = frame["season"]
    return frame[WEEKLY_COLUMNS]


def build_identity(source: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    mapping = pd.read_csv(
        MAPPING_FILE,
        dtype={"player_id": "string", "sleeper_player_id": "string"},
        keep_default_na=False,
    )
    validate_required_columns(mapping, MAPPING_IDENTITY_COLUMNS, "player mapping")
    mapping["headshot_url"] = ""
    if mapping["player_id"].duplicated().any():
        raise ValueError("Player mapping contains duplicate player_id values.")
    latest = (
        source.sort_values(["season", "week"])
        .drop_duplicates("player_id", keep="last")
        .rename(columns={"player_display_name": "nflverse_name", "position": "nflverse_position", "position_group": "nflverse_position_group", "team": "nflverse_team"})
        [["player_id", "nflverse_name", "nflverse_position", "nflverse_position_group", "nflverse_team"]]
    )
    valid_headshots = source["headshot_url"].astype("string").str.strip().ne("") & source["headshot_url"].notna()
    latest_headshots = (
        source.loc[valid_headshots, ["player_id", "season", "week", "headshot_url"]]
        .sort_values(["season", "week"])
        .drop_duplicates("player_id", keep="last")
        [["player_id", "headshot_url"]]
    )
    latest = latest.merge(latest_headshots, on="player_id", how="left", validate="one_to_one")
    existing_ids = set(mapping["player_id"])
    new = latest[~latest["player_id"].isin(existing_ids)].copy()
    additions = pd.DataFrame({column: "" for column in IDENTITY_COLUMNS}, index=new.index)
    additions["player_id"] = new["player_id"]
    additions["player_name"] = new["nflverse_name"].fillna("")
    additions["historical_position"] = new["nflverse_position"].fillna("")
    additions["position_group"] = new["nflverse_position_group"].fillna("")
    additions["historical_team"] = new["nflverse_team"].fillna("")
    additions["match_method"] = "not_in_sleeper_mapping"
    additions["confidence"] = "unmatched"
    identity = pd.concat([mapping[IDENTITY_COLUMNS], additions[IDENTITY_COLUMNS]], ignore_index=True)
    # nflverse is authoritative for historical display name/position/team. Sleeper
    # fields and all manually verified mapping decisions remain unchanged.
    identity = identity.merge(latest, on="player_id", how="left", validate="one_to_one")
    identity["player_name"] = identity["nflverse_name"].fillna(identity["player_name"])
    identity["historical_position"] = identity["nflverse_position"].fillna(identity["historical_position"])
    identity["position_group"] = identity["nflverse_position_group"].fillna(identity["position_group"])
    identity["historical_team"] = identity["nflverse_team"].fillna(identity["historical_team"])
    identity["headshot_url"] = identity["headshot_url_y"].fillna(identity["headshot_url_x"])
    identity = identity[IDENTITY_COLUMNS].sort_values("player_id").reset_index(drop=True)
    identity["sleeper_player_id"] = identity["sleeper_player_id"].fillna("").astype("string")
    if identity["sleeper_player_id"].str.endswith(".0").any():
        raise ValueError("Player identity contains float-formatted Sleeper IDs.")
    return identity, len(new)


def validate_weekly_stats(frame: pd.DataFrame) -> int:
    validate_required_columns(frame, WEEKLY_COLUMNS, "weekly stats")
    if frame[["player_id", "season", "week"]].isna().any().any():
        raise ValueError("Weekly stats contains null player_id, season, or week values.")
    seasons = sorted(frame["season"].dropna().astype(int).unique())
    if not seasons or seasons != list(range(seasons[0], seasons[-1] + 1)) or not frame["week"].between(1, 30).all():
        raise ValueError("Weekly stats contains invalid season or week values.")
    if set(frame["season_type"].unique()) - {"REG", "POST"}:
        raise ValueError("Weekly stats contains an unsupported season_type.")
    if set(frame["historical_position"].unique()) - FANTASY_POSITIONS:
        raise ValueError("Weekly stats contains a non-fantasy historical position.")
    duplicates = frame.duplicated(LOGICAL_KEY, keep=False)
    duplicate_count = int(duplicates.sum())
    if duplicate_count:
        sample = frame.loc[duplicates, LOGICAL_KEY].head().to_string(index=False)
        raise ValueError(f"Found {duplicate_count} duplicate weekly records. No rows were dropped. Sample:\n{sample}")
    scoring_delta = (frame["fantasy_points_ppr"] - frame["fantasy_points_standard"] - frame["receptions"]).abs()
    if scoring_delta.fillna(0).gt(1e-8).any():
        raise ValueError("nflverse Standard/PPR values do not differ solely by receptions.")
    return duplicate_count


def main() -> None:
    paths = source_files()
    source_seasons = [int(SOURCE_FILE_PATTERN.match(path.name).group(1)) for path in paths]
    print(f"Loading nflverse weekly player stats for {source_seasons[0]}–{source_seasons[-1]}...")
    source = load_nflverse()
    weekly = normalize_weekly(source)
    duplicate_count = validate_weekly_stats(weekly)
    identity, added_identities = build_identity(source)
    unknown = set(weekly["player_id"]) - set(identity["player_id"])
    if unknown:
        raise ValueError(f"Weekly output has {len(unknown)} player IDs absent from player identity.")
    sleeper_by_id = identity.set_index("player_id")["sleeper_player_id"]
    weekly.insert(1, "sleeper_player_id", weekly["player_id"].map(sleeper_by_id).fillna("").astype("string"))
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    identity.to_csv(IDENTITY_OUTPUT, index=False, na_rep="")
    weekly.to_csv(WEEKLY_OUTPUT, index=False, na_rep="")
    counts = weekly.groupby(["season", "season_type"]).size()
    used = identity["player_id"].isin(weekly["player_id"])
    mapped_players = int(identity.loc[used, "sleeper_player_id"].ne("").sum())
    print("\n========== NFLVERSE HISTORICAL ETL ==========")
    print(f"Source files:               {len(paths):,}")
    print(f"Supported range:            {source_seasons[0]}–{source_seasons[-1]}")
    print(f"Weekly rows produced:       {len(weekly):,}")
    print(f"Duplicate logical rows:     {duplicate_count:,}")
    print(f"Fantasy players:            {weekly['player_id'].nunique():,}")
    print(f"Players mapped to Sleeper:  {mapped_players:,}")
    print(f"Players without mapping:    {weekly['player_id'].nunique() - mapped_players:,}")
    print(f"New GSIS identities added:  {added_identities:,}")
    print(f"REG rows:                   {(weekly['season_type'] == 'REG').sum():,}")
    print(f"POST rows:                  {(weekly['season_type'] == 'POST').sum():,}")
    print("\nRows by season/type:")
    for (season, season_type), count in counts.items():
        print(f"  {season} {season_type}: {count:,}")
    print("\nUnique players by season:")
    for season, count in weekly.groupby("season")["player_id"].nunique().items():
        print(f"  {season}: {count:,}")
    print(f"\nIdentity output: {IDENTITY_OUTPUT}")
    print(f"Weekly output:   {WEEKLY_OUTPUT}")


if __name__ == "__main__":
    main()
