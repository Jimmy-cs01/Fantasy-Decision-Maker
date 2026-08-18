#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ARTIFACT = Path("artifacts/projections/v3_1")
FEATURES = Path("data/processed/player_week_projection_features_v3.csv.gz")
CURRENT = Path("data/processed/player_projections_v3_1.csv")


def attach_features(predictions: pd.DataFrame, features: pd.DataFrame) -> pd.DataFrame:
    columns = [
        "player_id", "season", "week", "career_games_before", "prior_season_games",
        "prior_season_position_rank_pct", "pbp_pass_attempts_l3", "pbp_pass_attempts_season_avg",
        "pbp_touches_l3", "pbp_touches_season_avg", "pbp_targets_l3", "pbp_targets_season_avg",
    ]
    return predictions.merge(features[columns], on=["player_id", "season", "week"], how="left", validate="one_to_one")


def main() -> None:
    manifest = json.loads((ARTIFACT / "manifest.json").read_text())
    features = pd.read_csv(FEATURES, dtype={"player_id": "string"})
    history_rows = []
    transition_rows = []
    for split in ("validation", "test"):
        predictions = pd.read_csv(ARTIFACT / f"{split}_predictions.csv.gz", dtype={"player_id": "string"})
        frame = attach_features(predictions, features)
        frame["history_bucket"] = pd.cut(
            frame["career_games_before"].fillna(0), [-1, 0, 3, 8, 16, np.inf],
            labels=["0 games", "1-3 games", "4-8 games", "9-16 games", "17+ games"],
        )
        for bucket, rows in frame.groupby("history_bucket", observed=True):
            for model in ("v2", "v3", "v3_1", "position_ensemble"):
                error = rows[model] - rows["fantasy_points_ppr"]
                history_rows.append({
                    "split": split, "history_bucket": bucket, "model": model,
                    "rows": len(rows), "average_projection": rows[model].mean(),
                    "mae": error.abs().mean(), "bias": error.mean(),
                })
        recent = np.select(
            [frame.historical_position.eq("QB"), frame.historical_position.eq("RB")],
            [frame.pbp_pass_attempts_l3, frame.pbp_touches_l3], default=frame.pbp_targets_l3,
        )
        baseline = np.select(
            [frame.historical_position.eq("QB"), frame.historical_position.eq("RB")],
            [frame.pbp_pass_attempts_season_avg, frame.pbp_touches_season_avg], default=frame.pbp_targets_season_avg,
        )
        frame["previous_role"] = baseline
        frame["new_role"] = recent
        frame["role_change"] = np.where(recent >= baseline * 1.35, "increase", np.where(recent <= baseline * 0.65, "decrease", "stable"))
        transition_rows.append(frame.loc[frame.role_change.ne("stable"), [
            "player_id", "season", "week", "historical_position", "previous_role", "new_role",
            "v2", "v3", "v3_1", "position_ensemble", "fantasy_points_ppr", "role_change",
        ]].assign(split=split))
    history = pd.DataFrame(history_rows)
    history.to_csv("data/processed/model_v3_1_history_buckets.csv", index=False)
    transitions = pd.concat(transition_rows, ignore_index=True)
    transitions.to_csv("data/processed/model_v3_1_role_transitions.csv", index=False)

    current = pd.read_csv(CURRENT)
    names = ["Frank Gore Jr.", "Jarquez Hunter", "Brock Bowers", "Colston Loveland", "Trey McBride"]
    print("Frozen candidate:", manifest["frozen_candidate"])
    print("2025 MAE:", {name: details["mae"] for name, details in manifest["test"].items() if isinstance(details, dict) and "mae" in details})
    print("Current named sanity:")
    print(current.loc[current.player_name.isin(names), [
        "player_name", "position", "depth_rank", "history_category", "role_confidence",
        "expected_pass_attempts", "expected_rush_attempts", "expected_targets",
        "floor_ppr", "model_projection_ppr", "ceiling_ppr",
    ]].sort_values("player_name").to_string(index=False))
    print("History report: data/processed/model_v3_1_history_buckets.csv")
    print("Role transitions: data/processed/model_v3_1_role_transitions.csv")


if __name__ == "__main__":
    main()

