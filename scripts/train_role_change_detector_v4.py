#!/usr/bin/env python3
"""Compare the prior usage-only role detector with leakage-safe v4 role state."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix
from xgboost import XGBClassifier

from projection_pipeline.v3_2_config import RANDOM_SEED, ROLLING_FOLDS, V3_2_FEATURE_DATASET_PATH
from train_role_change_detector_v3_4 import FEATURES as BASE_FEATURES, LABELS, role_labels

ROOT = Path(__file__).resolve().parents[1]
ROLE_PATH = ROOT / "data/processed/player_week_role_state_v4.csv.gz"
OUTPUT = ROOT / "data/processed/v4_role_detector_report.json"
PREDICTIONS = ROOT / "data/processed/v4_role_detector_oof.csv.gz"
ROLE_FEATURES = (
    "depth_rank_input", "starter_input", "depth_observed", "roster_active",
    "roster_status_missing", "injury_severity_input", "practice_limited_input",
    "injury_observed", "team_changed", "weeks_since_team_change", "role_confidence",
)


def fit_predict(train, validation, features):
    model = XGBClassifier(
        objective="multi:softprob", num_class=3, n_estimators=200, max_depth=3,
        learning_rate=.035, subsample=.85, colsample_bytree=.8,
        min_child_weight=8, reg_lambda=5, n_jobs=4, random_state=RANDOM_SEED,
    )
    weights = train.role_label.map({0: 1.8, 1: .55, 2: 1.8}).to_numpy(float)
    model.fit(train[list(features)], train.role_label, sample_weight=weights)
    return model.predict_proba(validation[list(features)])


def main():
    frame = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string"})
    roles = pd.read_csv(ROLE_PATH, dtype={"player_id": "string"})
    columns = ["player_id", "season", "week", *ROLE_FEATURES]
    frame = frame.merge(roles[columns], on=["player_id", "season", "week"], how="left", validate="one_to_one")
    frame = frame.loc[frame.career_games_before.ge(1)].copy()
    for column in ROLE_FEATURES:
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0)
    frame["role_label"] = role_labels(frame)
    variants = {"usage_only": BASE_FEATURES, "v4_role_state": (*BASE_FEATURES, *ROLE_FEATURES)}
    rows = []
    for train_end, year in ROLLING_FOLDS:
        train = frame.loc[frame.season.between(2018, train_end)]
        validation = frame.loc[frame.season.eq(year)].copy()
        fold = validation[["player_id", "season", "week", "historical_position", "role_label"]].copy()
        for name, features in variants.items():
            probabilities = fit_predict(train, validation, features)
            fold[f"{name}_predicted"] = probabilities.argmax(axis=1)
            fold[f"{name}_rising_probability"] = probabilities[:, 2]
            fold[f"{name}_falling_probability"] = probabilities[:, 0]
        rows.append(fold)
    oof = pd.concat(rows, ignore_index=True)
    report = {"rows": len(oof), "production_unchanged": True, "variants": {}}
    for name in variants:
        predicted = oof[f"{name}_predicted"]
        report["variants"][name] = {
            "classification": classification_report(oof.role_label, predicted, labels=[0, 1, 2],
                target_names=[LABELS[i] for i in range(3)], output_dict=True, zero_division=0),
            "confusion_matrix": confusion_matrix(oof.role_label, predicted, labels=[0, 1, 2]).tolist(),
        }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    oof.to_csv(PREDICTIONS, index=False, compression="gzip")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
