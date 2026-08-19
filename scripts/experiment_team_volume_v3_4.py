#!/usr/bin/env python3
"""Chronological team-volume model versus v3.3.2 rolling heuristic."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from projection_pipeline.v3_2_config import RANDOM_SEED, ROLLING_FOLDS, V3_2_FEATURE_DATASET_PATH


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/v3_4_team_volume_report.json"
FEATURES = [
    "team_offensive_plays_season_avg", "team_offensive_plays_l3", "team_offensive_plays_l5", "team_offensive_plays_l8",
    "team_pass_rate_season_avg", "team_pass_rate_l3", "team_pass_rate_l5", "team_pass_rate_l8",
    "team_neutral_pass_rate_season_avg", "team_neutral_pass_rate_l3", "team_neutral_pass_rate_l5", "team_neutral_pass_rate_l8",
    "team_red_zone_plays_season_avg", "team_red_zone_plays_l3", "team_red_zone_plays_l5", "team_red_zone_plays_l8",
    "is_home", "days_rest", "short_week", "long_rest", "returning_from_bye", "is_thursday",
]


def metrics(actual, predicted):
    error = np.asarray(predicted) - np.asarray(actual)
    return {"mae": float(np.abs(error).mean()), "rmse": float(np.sqrt(np.square(error).mean())), "bias": float(error.mean())}


def team_frame(players: pd.DataFrame) -> pd.DataFrame:
    keys = ["season", "week", "team"]
    first = players.sort_values(keys).groupby(keys, as_index=False).first()
    actual = players.groupby(keys, as_index=False).agg(
        actual_pass_attempts=("pbp_pass_attempts", "sum"),
        actual_rush_attempts=("pbp_rush_attempts", "sum"),
        actual_targets=("pbp_targets", "sum"),
    )
    return first[keys + FEATURES].merge(actual, on=keys, validate="one_to_one")


def main() -> None:
    players = pd.read_csv(V3_2_FEATURE_DATASET_PATH)
    teams = team_frame(players)
    folds = []
    for train_end, year in ROLLING_FOLDS:
        train, validation = teams.loc[teams.season.between(2018, train_end)], teams.loc[teams.season.eq(year)].copy()
        plays = validation.team_offensive_plays_l3.fillna(64).clip(45, 85)
        rate = validation.team_pass_rate_l3.fillna(.56).clip(.35, .75)
        validation["heuristic_pass"] = (plays * rate).clip(25, 48)
        validation["heuristic_rush"] = (plays * (1 - rate)).clip(16, 40)
        validation["heuristic_targets"] = validation.heuristic_pass * .911765
        for target, short in (("actual_pass_attempts", "pass"), ("actual_rush_attempts", "rush"), ("actual_targets", "targets")):
            model = XGBRegressor(
                objective="reg:squarederror", n_estimators=220, max_depth=3, learning_rate=.035,
                min_child_weight=12, subsample=.85, colsample_bytree=.8, reg_lambda=6,
                n_jobs=4, random_state=RANDOM_SEED,
            ).fit(train[FEATURES], train[target])
            validation[f"model_{short}"] = np.maximum(0, model.predict(validation[FEATURES]))
        folds.append(validation)
    oof = pd.concat(folds, ignore_index=True)
    actual_names = {"pass": "actual_pass_attempts", "rush": "actual_rush_attempts", "targets": "actual_targets"}
    report = {
        target: {
            "heuristic": metrics(oof[actual_names[target]], oof[f"heuristic_{target}"]),
            "model": metrics(oof[actual_names[target]], oof[f"model_{target}"]),
        } for target in actual_names
    }
    report["folds"] = {
        str(year): {target: {
            "heuristic": metrics(group[actual_names[target]], group[f"heuristic_{target}"]),
            "model": metrics(group[actual_names[target]], group[f"model_{target}"]),
        } for target in actual_names} for year, group in oof.groupby("season")
    }
    report["production_unchanged"] = True
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    print("No production or remote changes were made.")


if __name__ == "__main__":
    main()
