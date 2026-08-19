#!/usr/bin/env python3
"""Leakage-safe QB rush decomposition experiment: designed runs + scrambles."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR
from projection_pipeline.v3_2_config import RANDOM_SEED, ROLLING_FOLDS, V3_2_ARTIFACT_DIR, V3_2_FEATURE_DATASET_PATH


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/v3_4_qb_rushing_report.json"


def metrics(actual, predicted):
    actual, predicted = np.asarray(actual, dtype=float), np.asarray(predicted, dtype=float)
    finite = np.isfinite(actual) & np.isfinite(predicted)
    error = predicted[finite] - actual[finite]
    return {
        "rows": len(error), "mae": float(np.abs(error).mean()),
        "rmse": float(np.sqrt(np.square(error).mean())), "bias": float(error.mean()),
        "gt_3_attempt_error": float((np.abs(error) > 3).mean()),
    }


def fit(train, features, target, params):
    usable = train.loc[train[target].notna()]
    return XGBRegressor(
        **params, objective="reg:squarederror", eval_metric="mae", n_jobs=4,
        random_state=RANDOM_SEED,
    ).fit(usable[features], usable[target])


def main() -> None:
    frame = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string"})
    frame = frame.loc[frame.historical_position.eq("QB") & frame.career_games_before.ge(1)].copy()
    manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    features = manifest["models"]["QB"]["features"]
    params = json.loads((V3_1_ARTIFACT_DIR / "manifest.json").read_text())["hyperparameters"]
    folds = []
    for train_end, year in ROLLING_FOLDS:
        train = frame.loc[frame.season.between(2018, train_end)]
        validation = frame.loc[frame.season.eq(year)].copy()
        total_model = fit(train, features, "pbp_rush_attempts", params)
        designed_model = fit(train, features, "designed_rushes", params)
        scramble_model = fit(train, features, "scrambles", params)
        validation["total_model"] = np.maximum(0, total_model.predict(validation[features]))
        validation["designed_model"] = np.maximum(0, designed_model.predict(validation[features]))
        validation["scramble_model"] = np.maximum(0, scramble_model.predict(validation[features]))
        validation["decomposed"] = validation.designed_model + validation.scramble_model
        folds.append(validation)
    oof = pd.concat(folds, ignore_index=True)
    high = oof.prior_season_rush_attempts_pg.fillna(0).ge(5)
    report = {
        "overall": {name: metrics(oof.pbp_rush_attempts, oof[name]) for name in ("total_model", "decomposed")},
        "high_rush_qb": {name: metrics(oof.loc[high, "pbp_rush_attempts"], oof.loc[high, name]) for name in ("total_model", "decomposed")},
        "components": {
            "designed": metrics(oof.designed_rushes, oof.designed_model),
            "scrambles": metrics(oof.scrambles, oof.scramble_model),
        },
        "folds": {str(year): {name: metrics(group.pbp_rush_attempts, group[name]) for name in ("total_model", "decomposed")} for year, group in oof.groupby("season")},
        "production_unchanged": True,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    print("No production or remote changes were made.")


if __name__ == "__main__":
    main()
