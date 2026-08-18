#!/usr/bin/env python3
"""Download, normalize, and audit official nflverse/PFR snap counts locally.

This pipeline is deliberately independent from the production weekly-stat
importer. It writes only ignored local artifacts and never contacts Supabase.
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

RAW_DIR = Path("data/raw/snap_counts")
OUTPUT = Path("data/processed/player_weekly_snap_statistics.csv.gz")
REPORT_OUTPUT = Path("data/processed/player_weekly_snap_statistics.report.json")
IDENTITY_PATH = Path("data/processed/player_identity.csv")
HISTORICAL_PATH = Path("data/processed/historical_weekly_player_stats.csv")
SOURCE_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/"
    "snap_counts/snap_counts_{season}.csv"
)
DEFAULT_START_SEASON = 2018
DEFAULT_END_SEASON = 2025
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE"}
TEAM_ALIASES = {"OAK": "LV", "STL": "LA", "SD": "LAC"}
REQUIRED_SOURCE_COLUMNS = {
    "game_id", "pfr_game_id", "season", "game_type", "week", "player",
    "pfr_player_id", "position", "team", "opponent", "offense_snaps",
    "offense_pct", "defense_snaps", "defense_pct", "st_snaps", "st_pct",
}
OUTPUT_COLUMNS = [
    "player_id", "pfr_player_id", "player_name", "season", "week",
    "season_type", "game_id", "team", "opponent_team", "source_team",
    "historical_position", "source_position", "offensive_snaps",
    "team_offensive_snaps", "offensive_snap_pct", "defensive_snaps",
    "defensive_snap_pct", "special_teams_snaps", "special_teams_snap_pct",
    "source", "source_dataset", "source_season", "generated_at",
]


def normalize_team(value: object) -> str:
    team = "" if value is None or pd.isna(value) else str(value).strip().upper()
    return TEAM_ALIASES.get(team, team)


def round_percentage_half_up(values: pd.Series | np.ndarray) -> np.ndarray:
    numeric = np.asarray(values, dtype=float)
    return np.floor(numeric * 100 + 0.5 + 1e-12) / 100


def infer_team_offensive_snaps(group: pd.DataFrame) -> int:
    """Recover PFR's integer percentage denominator from rounded percentages."""
    snaps = pd.to_numeric(group["offense_snaps"], errors="raise").to_numpy(float)
    percentages = pd.to_numeric(group["offense_pct"], errors="raise").to_numpy(float)
    maximum = int(np.nanmax(snaps))
    if maximum <= 0:
        return 0

    def score(total: int) -> tuple[int, float, int]:
        error = np.abs(round_percentage_half_up(snaps / total) - percentages)
        return int((error > 0.0050001).sum()), float(error.sum()), total

    if score(maximum)[:2] == (0, 0.0):
        return maximum
    return min(score(total) for total in range(maximum, maximum + 31))[2]


def validate_source(frame: pd.DataFrame, expected_season: int) -> None:
    missing = sorted(REQUIRED_SOURCE_COLUMNS - set(frame.columns))
    if missing:
        raise ValueError(f"Snap source for {expected_season} is missing: {', '.join(missing)}")
    seasons = set(pd.to_numeric(frame["season"], errors="raise").astype(int).unique())
    if seasons != {expected_season}:
        raise ValueError(f"Snap source must contain only {expected_season}; found {sorted(seasons)}")
    if frame[["game_id", "week", "pfr_player_id", "team"]].isna().any().any():
        raise ValueError(f"Snap source for {expected_season} has null identity/game fields")
    if frame.duplicated(["pfr_player_id", "game_id", "team"]).any():
        raise ValueError(f"Snap source for {expected_season} has duplicate player-game-team rows")
    percentage_columns = ["offense_pct", "defense_pct", "st_pct"]
    percentages = frame[percentage_columns].apply(pd.to_numeric, errors="coerce")
    # PFR has a small number of rounded defense/ST values at 1.01. Preserve
    # those provider values for auditing; offensive share must remain 0–1.
    if (
        percentages.isna().any().any()
        or not percentages["offense_pct"].between(0, 1).all()
        or not percentages[["defense_pct", "st_pct"]].stack().between(0, 1.05).all()
    ):
        raise ValueError(f"Snap source for {expected_season} has invalid percentages")


def download_source(season: int, target: Path, replace_invalid: bool = False) -> str:
    if target.exists():
        try:
            validate_source(pd.read_csv(target, low_memory=False), season)
            return "existing"
        except ValueError:
            if not replace_invalid:
                raise
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        SOURCE_URL.format(season=season),
        headers={"Accept": "text/csv", "User-Agent": "jimmy-gm-snap-audit"},
    )
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=f".{target.name}.", delete=False) as temporary:
        temporary_path = Path(temporary.name)
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                while chunk := response.read(1024 * 1024):
                    temporary.write(chunk)
        except Exception:
            temporary_path.unlink(missing_ok=True)
            raise
    try:
        frame = pd.read_csv(temporary_path, low_memory=False)
        validate_source(frame, season)
        os.replace(temporary_path, target)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    return "downloaded"


def load_sources(raw_dir: Path, start_season: int, end_season: int) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for season in range(start_season, end_season + 1):
        path = raw_dir / f"snap_counts_{season}.csv"
        if not path.exists():
            raise FileNotFoundError(f"Missing {path}; run npm run data:snaps first")
        frame = pd.read_csv(path, dtype={"pfr_player_id": "string"}, low_memory=False)
        validate_source(frame, season)
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)


def _canonical_weekly_teams(historical: pd.DataFrame) -> pd.DataFrame:
    keys = ["player_id", "season", "week", "season_type"]
    teams = historical[keys + ["team"]].dropna(subset=["team"]).drop_duplicates()
    ambiguous = teams.groupby(keys)["team"].nunique().gt(1)
    if ambiguous.any():
        bad = ambiguous[ambiguous].index.tolist()[:5]
        raise ValueError(f"Historical stats have multiple teams for one player-week: {bad}")
    return teams.rename(columns={"team": "historical_team"})


def _opponent_from_game(game_id: str, team: str, fallback: str) -> str:
    parts = str(game_id).split("_")
    if len(parts) >= 4:
        away, home = normalize_team(parts[-2]), normalize_team(parts[-1])
        if team == away:
            return home
        if team == home:
            return away
    return normalize_team(fallback)


def normalize_snap_counts(
    source: pd.DataFrame,
    identity: pd.DataFrame,
    historical: pd.DataFrame,
    generated_at: str,
) -> tuple[pd.DataFrame, dict]:
    identities = identity[["player_id", "pfr_player_id", "player_name", "historical_position"]].copy()
    identities["pfr_player_id"] = identities["pfr_player_id"].astype("string").str.strip()
    identities = identities[identities["pfr_player_id"].notna() & identities["pfr_player_id"].ne("")]
    if identities["pfr_player_id"].duplicated().any():
        raise ValueError("Player identity contains duplicate PFR IDs")

    frame = source.copy()
    frame["source_team"] = frame["team"].astype("string").str.upper()
    totals = (
        frame.groupby(["game_id", "source_team"], sort=False, group_keys=False)
        .apply(infer_team_offensive_snaps, include_groups=False)
        .rename("team_offensive_snaps")
        .reset_index()
    )
    frame = frame.merge(totals, on=["game_id", "source_team"], validate="many_to_one")
    frame = frame.merge(identities, on="pfr_player_id", how="left", validate="many_to_one")

    source_fantasy = frame["position"].astype("string").str.upper().isin(FANTASY_POSITIONS)
    source_mapping = {
        "fantasy_position_rows": int(source_fantasy.sum()),
        "mapped_rows": int((source_fantasy & frame["player_id"].notna()).sum()),
        "unmatched_rows": int((source_fantasy & frame["player_id"].isna()).sum()),
    }
    source_mapping["mapping_rate"] = (
        source_mapping["mapped_rows"] / source_mapping["fantasy_position_rows"]
        if source_mapping["fantasy_position_rows"] else None
    )
    unmatched = (
        frame.loc[source_fantasy & frame["player_id"].isna(), ["pfr_player_id", "player", "position"]]
        .value_counts().head(20).reset_index(name="rows").to_dict("records")
    )

    frame = frame[
        frame["player_id"].notna()
        & frame["historical_position"].astype("string").str.upper().isin(FANTASY_POSITIONS)
    ].copy()
    frame["season_type"] = np.where(frame["game_type"].eq("REG"), "REG", "POST")
    frame["team"] = frame["source_team"].map(normalize_team)
    canonical_teams = _canonical_weekly_teams(historical)
    join_keys = ["player_id", "season", "week", "season_type"]
    frame = frame.merge(canonical_teams, on=join_keys, how="left", validate="one_to_one")
    frame["team"] = frame["historical_team"].fillna(frame["team"]).map(normalize_team)
    frame["opponent_team"] = [
        _opponent_from_game(game_id, team, opponent)
        for game_id, team, opponent in zip(frame["game_id"], frame["team"], frame["opponent"])
    ]

    output = pd.DataFrame({
        "player_id": frame["player_id"].astype("string"),
        "pfr_player_id": frame["pfr_player_id"].astype("string"),
        "player_name": frame["player_name"].fillna(frame["player"]),
        "season": pd.to_numeric(frame["season"], errors="raise").astype(int),
        "week": pd.to_numeric(frame["week"], errors="raise").astype(int),
        "season_type": frame["season_type"],
        "game_id": frame["game_id"].astype("string"),
        "team": frame["team"],
        "opponent_team": frame["opponent_team"],
        "source_team": frame["source_team"],
        "historical_position": frame["historical_position"].astype("string").str.upper(),
        "source_position": frame["position"].astype("string").str.upper(),
        "offensive_snaps": pd.to_numeric(frame["offense_snaps"], errors="raise").astype(int),
        "team_offensive_snaps": pd.to_numeric(frame["team_offensive_snaps"], errors="raise").astype(int),
        "offensive_snap_pct": pd.to_numeric(frame["offense_pct"], errors="raise"),
        "defensive_snaps": pd.to_numeric(frame["defense_snaps"], errors="raise").astype(int),
        "defensive_snap_pct": pd.to_numeric(frame["defense_pct"], errors="raise"),
        "special_teams_snaps": pd.to_numeric(frame["st_snaps"], errors="raise").astype(int),
        "special_teams_snap_pct": pd.to_numeric(frame["st_pct"], errors="raise"),
        "source": "nflverse/PFR",
        "source_dataset": "snap_counts",
        "source_season": pd.to_numeric(frame["season"], errors="raise").astype(int),
        "generated_at": generated_at,
    })[OUTPUT_COLUMNS]
    output = output.sort_values(["season", "week", "team", "historical_position", "player_id"]).reset_index(drop=True)
    duplicate_key = ["player_id", "season", "week", "season_type", "team"]
    if output.duplicated(duplicate_key).any():
        raise ValueError("Normalized snaps contain duplicate player-week-team rows")

    calculated = round_percentage_half_up(
        output["offensive_snaps"] / output["team_offensive_snaps"].replace(0, np.nan)
    )
    valid = output["team_offensive_snaps"].gt(0)
    percentage_difference = np.abs(
        calculated[valid] - output.loc[valid, "offensive_snap_pct"].to_numpy()
    )
    diagnostics = {
        "source_mapping": source_mapping,
        "unmatched_source_fantasy_examples": unmatched,
        "normalized_rows": len(output),
        "unique_players": int(output["player_id"].nunique()),
        "duplicates": 0,
        # PFR's displayed whole-percent conversion is inconsistent at exact
        # .5 ties. Preserve its percentage and distinguish those 1-point
        # rounding differences from material denominator mismatches.
        "percentage_rounding_differences_1pp": int(
            ((percentage_difference > 0.0050001) & (percentage_difference <= 0.0100001)).sum()
        ),
        "percentage_math_mismatches_gt_1pp": int((percentage_difference > 0.0100001).sum()),
        "canonical_team_overrides": int(
            (frame["historical_team"].notna() & frame["historical_team"].map(normalize_team).ne(frame["source_team"].map(normalize_team))).sum()
        ),
    }
    return output, diagnostics


def build_shifted_snap_features(frame: pd.DataFrame) -> pd.DataFrame:
    ordered = frame.sort_values(["player_id", "season", "week"]).copy()
    grouped = ordered.groupby("player_id", sort=False)["offensive_snap_pct"]
    ordered["snap_pct_last_1"] = grouped.shift(1)
    ordered["snap_pct_last_3"] = grouped.transform(
        lambda values: values.shift(1).rolling(3, min_periods=1).mean()
    )
    ordered["snap_pct_last_5"] = grouped.transform(
        lambda values: values.shift(1).rolling(5, min_periods=1).mean()
    )
    ordered["snap_pct_delta_1"] = ordered["snap_pct_last_1"] - grouped.shift(2)
    return ordered


def coverage_report(output: pd.DataFrame, historical: pd.DataFrame) -> dict:
    keys = ["player_id", "season", "week", "season_type"]
    target = historical[
        historical["season"].between(int(output["season"].min()), int(output["season"].max()))
        & historical["historical_position"].isin(FANTASY_POSITIONS)
    ].copy()
    joined = target.merge(output[keys + ["offensive_snaps"]], on=keys, how="left", validate="one_to_one")
    rows = []
    for (season, position), group in joined.groupby(["season", "historical_position"]):
        matched = int(group["offensive_snaps"].notna().sum())
        rows.append({
            "season": int(season), "position": position, "player_weeks": len(group),
            "with_snap_count": matched, "coverage_pct": round(100 * matched / len(group), 4),
        })
    return {
        "overall": {
            "player_weeks": len(joined),
            "with_snap_count": int(joined["offensive_snaps"].notna().sum()),
            "coverage_pct": round(100 * joined["offensive_snaps"].notna().mean(), 4),
        },
        "by_season_position": rows,
    }


def predictive_report(output: pd.DataFrame, historical: pd.DataFrame) -> dict:
    from sklearn.compose import ColumnTransformer
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import Ridge
    from sklearn.metrics import mean_absolute_error
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler

    keys = ["player_id", "season", "week", "season_type"]
    stats = historical[historical["season_type"].eq("REG")].merge(
        output[keys + ["offensive_snap_pct"]], on=keys, how="inner", validate="one_to_one"
    )
    stats = stats.sort_values(["player_id", "season", "week"]).reset_index(drop=True)
    grouped = stats.groupby("player_id", sort=False)
    stats["opportunities"] = stats["rush_attempts"].fillna(0) + stats["targets"].fillna(0)
    stats["ppr_last_1"] = grouped["fantasy_points_ppr"].shift(1)
    stats["ppr_last_3"] = grouped["fantasy_points_ppr"].transform(
        lambda values: values.shift(1).rolling(3, min_periods=1).mean()
    )
    stats["opportunities_last_1"] = grouped["opportunities"].shift(1)
    stats["opportunities_last_3"] = grouped["opportunities"].transform(
        lambda values: values.shift(1).rolling(3, min_periods=1).mean()
    )
    stats = build_shifted_snap_features(stats)

    correlations = {}
    snap_columns = ["snap_pct_last_1", "snap_pct_last_3", "snap_pct_last_5", "snap_pct_delta_1"]
    for target in ["fantasy_points_ppr", "targets", "rush_attempts", "opportunities"]:
        correlations[target] = {
            column: round(float(stats[column].corr(stats[target])), 6) for column in snap_columns
        }

    train = stats[stats["season"].le(2023)]
    test = stats[stats["season"].ge(2024)]
    baseline = ["ppr_last_1", "ppr_last_3", "opportunities_last_1", "opportunities_last_3"]
    enhanced = baseline + snap_columns

    def ridge_mae(columns: list[str]) -> float:
        preprocessor = ColumnTransformer([
            ("numeric", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), columns),
            ("position", OneHotEncoder(handle_unknown="ignore"), ["historical_position"]),
        ])
        model = make_pipeline(preprocessor, Ridge(alpha=10.0))
        model.fit(train[columns + ["historical_position"]], train["fantasy_points_ppr"])
        prediction = model.predict(test[columns + ["historical_position"]])
        return round(float(mean_absolute_error(test["fantasy_points_ppr"], prediction)), 6)

    role_changes = {}
    for label, mask in {
        "increase_20pp": stats["snap_pct_delta_1"].ge(0.20),
        "decrease_20pp": stats["snap_pct_delta_1"].le(-0.20),
        "stable_5pp": stats["snap_pct_delta_1"].abs().le(0.05),
    }.items():
        subset = stats[mask]
        role_changes[label] = {
            "rows": len(subset),
            "next_game_opportunities": round(float(subset["opportunities"].mean()), 4),
            "next_game_ppr": round(float(subset["fantasy_points_ppr"].mean()), 4),
        }
    return {
        "rows": len(stats),
        "correlations": correlations,
        "simple_2024_2025_ridge_mae": {
            "usage_history_only": ridge_mae(baseline),
            "usage_history_plus_shifted_snaps": ridge_mae(enhanced),
        },
        "role_change_slices": role_changes,
        "leakage_note": "All snap features are shifted one game; Week N uses only games before Week N.",
    }


def build_report(output: pd.DataFrame, historical: pd.DataFrame, diagnostics: dict) -> dict:
    by_season = []
    for season, group in output.groupby("season"):
        by_season.append({
            "season": int(season), "rows": len(group),
            "player_weeks": len(group), "unique_players": int(group["player_id"].nunique()),
        })
    return {
        "source": "nflverse/PFR snap_counts",
        "source_release": "https://github.com/nflverse/nflverse-data/releases/tag/snap_counts",
        "source_format": "CSV (official release also supplies Parquet/RDS/QS)",
        "grain": "one player/game/team row",
        "seasons": [int(output["season"].min()), int(output["season"].max())],
        "rows": len(output),
        "compressed_output_bytes": None,
        "by_season": by_season,
        "coverage": coverage_report(output, historical),
        "predictive_utility": predictive_report(output, historical),
        **diagnostics,
    }


def print_report(report: dict) -> None:
    print("\n========== NFLVERSE SNAP AUDIT ==========")
    print(f"Source:                {report['source']}")
    print(f"Seasons:               {report['seasons'][0]}–{report['seasons'][1]}")
    print(f"Normalized rows:       {report['rows']:,}")
    print(f"Unique players:        {report['unique_players']:,}")
    print(f"Duplicate rows:        {report['duplicates']:,}")
    mapping = report["source_mapping"]
    print(f"PFR→GSIS mapping:      {mapping['mapped_rows']:,}/{mapping['fantasy_position_rows']:,} ({100 * mapping['mapping_rate']:.2f}%)")
    coverage = report["coverage"]["overall"]
    print(f"Historical coverage:   {coverage['with_snap_count']:,}/{coverage['player_weeks']:,} ({coverage['coverage_pct']:.2f}%)")
    print(f"1-point rounding ties: {report['percentage_rounding_differences_1pp']:,}")
    print(f">1-point mismatches:   {report['percentage_math_mismatches_gt_1pp']:,}")
    mae = report["predictive_utility"]["simple_2024_2025_ridge_mae"]
    print(f"Simple MAE, no snaps:  {mae['usage_history_only']:.4f}")
    print(f"Simple MAE, + snaps:   {mae['usage_history_plus_shifted_snaps']:.4f}")
    print("\nCoverage by season/position:")
    for row in report["coverage"]["by_season_position"]:
        print(f"  {row['season']} {row['position']}: {row['with_snap_count']:,}/{row['player_weeks']:,} ({row['coverage_pct']:.2f}%)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-season", type=int, default=DEFAULT_START_SEASON)
    parser.add_argument("--end-season", type=int, default=DEFAULT_END_SEASON)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--report", type=Path, default=REPORT_OUTPUT)
    parser.add_argument("--replace-invalid", action="store_true")
    parser.add_argument("--report-only", action="store_true", help="Audit existing local source files without downloading or writing outputs")
    args = parser.parse_args()
    if args.start_season > args.end_season:
        raise ValueError("start season must be no later than end season")

    if not args.report_only:
        for season in range(args.start_season, args.end_season + 1):
            target = args.raw_dir / f"snap_counts_{season}.csv"
            status = download_source(season, target, args.replace_invalid)
            print(f"{status.upper()} {season}: {target}")

    source = load_sources(args.raw_dir, args.start_season, args.end_season)
    identity = pd.read_csv(
        IDENTITY_PATH,
        dtype={"player_id": "string", "pfr_player_id": "string"},
        keep_default_na=True,
    )
    historical = pd.read_csv(
        HISTORICAL_PATH,
        dtype={"player_id": "string", "season_type": "string", "team": "string"},
        low_memory=False,
    )
    generated_at = datetime.now(UTC).isoformat()
    output, diagnostics = normalize_snap_counts(source, identity, historical, generated_at)
    report = build_report(output, historical, diagnostics)

    if not args.report_only:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        output.to_csv(args.output, index=False, compression="gzip")
        report["compressed_output_bytes"] = args.output.stat().st_size
        args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(f"Output: {args.output.resolve()} ({args.output.stat().st_size / 1_000_000:.2f} MB)")
        print(f"Report: {args.report.resolve()}")
    print_report(report)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, FileNotFoundError, urllib.error.URLError) as error:
        raise SystemExit(f"Snap audit failed: {error}")
