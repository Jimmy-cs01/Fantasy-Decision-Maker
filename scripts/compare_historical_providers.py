"""Create a one-time 2024 REG Kaggle-versus-nflverse discrepancy report."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

KAGGLE_FILE = Path("data/weekly_player_stats_offense.csv")
NFLVERSE_FILE = Path("data/processed/historical_weekly_player_stats.csv")
IDENTITY_FILE = Path("data/processed/player_identity.csv")
OUTPUT_FILE = Path("data/processed/provider_comparison_2024.csv")
KAGGLE_COLUMNS = [
    "player_id", "season", "season_type", "passing_yards", "pass_touchdown",
    "rushing_yards", "rush_touchdown", "receiving_yards", "receiving_touchdown",
    "fantasy_points_standard",
]
METRICS = [
    "passing_yards", "passing_touchdowns", "rushing_yards", "rushing_touchdowns",
    "receiving_yards", "receiving_touchdowns", "fantasy_points_standard",
]
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE"}


def load_kaggle_2024() -> pd.DataFrame:
    selected = []
    for chunk in pd.read_csv(
        KAGGLE_FILE,
        usecols=KAGGLE_COLUMNS,
        dtype={"player_id": "string", "season_type": "string"},
        chunksize=100_000,
        low_memory=False,
    ):
        selected.append(chunk[(chunk["season"] == 2024) & (chunk["season_type"] == "REG")])
    frame = pd.concat(selected, ignore_index=True).rename(columns={
        "pass_touchdown": "passing_touchdowns",
        "rush_touchdown": "rushing_touchdowns",
        "receiving_touchdown": "receiving_touchdowns",
    })
    return frame.groupby("player_id", as_index=False)[METRICS].sum()


def load_nflverse_2024() -> pd.DataFrame:
    columns = ["player_id", "season", "season_type", *METRICS]
    frame = pd.read_csv(NFLVERSE_FILE, usecols=columns, dtype={"player_id": "string", "season_type": "string"})
    frame = frame[(frame["season"] == 2024) & (frame["season_type"] == "REG")]
    return frame.groupby("player_id", as_index=False)[METRICS].sum()


def build_comparison(kaggle: pd.DataFrame, nflverse: pd.DataFrame) -> pd.DataFrame:
    comparison = kaggle.merge(nflverse, on="player_id", how="outer", suffixes=("_kaggle", "_nflverse")).fillna(0)
    for metric in METRICS:
        comparison[f"{metric}_delta"] = comparison[f"{metric}_nflverse"] - comparison[f"{metric}_kaggle"]
    names = pd.read_csv(IDENTITY_FILE, usecols=["player_id", "player_name", "historical_position"], dtype={"player_id": "string"})
    comparison = comparison.merge(names, on="player_id", how="left", validate="one_to_one")
    comparison = comparison[comparison["historical_position"].isin(FANTASY_POSITIONS)].copy()
    delta_columns = [f"{metric}_delta" for metric in METRICS]
    comparison["largest_absolute_difference"] = comparison[delta_columns].abs().max(axis=1)
    return comparison.sort_values(["largest_absolute_difference", "player_name"], ascending=[False, True])


def main() -> None:
    comparison = build_comparison(load_kaggle_2024(), load_nflverse_2024())
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    comparison.to_csv(OUTPUT_FILE, index=False, na_rep="")
    delta_columns = [f"{metric}_delta" for metric in METRICS]
    changed = comparison[delta_columns].abs().gt(1e-8).any(axis=1)
    print("========== 2024 PROVIDER COMPARISON ==========")
    print(f"Compared player-seasons:    {len(comparison):,}")
    print(f"Player-seasons differing:   {int(changed.sum()):,}")
    print(f"Exact matches:              {int((~changed).sum()):,}")
    print("\nLargest absolute discrepancies:")
    display = ["player_id", "player_name", *delta_columns]
    print(comparison.loc[changed, display].head(12).to_string(index=False))
    print(f"\nDiagnostic output: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
