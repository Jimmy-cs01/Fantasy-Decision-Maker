#!/usr/bin/env python3
"""Chronological, leakage-safe structural role-change classifier."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix
from xgboost import XGBClassifier

if __package__:
    from .projection_pipeline.v3_2_config import RANDOM_SEED, ROLLING_FOLDS, V3_2_FEATURE_DATASET_PATH
else:
    from projection_pipeline.v3_2_config import RANDOM_SEED, ROLLING_FOLDS, V3_2_FEATURE_DATASET_PATH


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/v3_4_role_detector_report.json"
PREDICTIONS = ROOT / "data/processed/v3_4_role_detector_oof.csv.gz"
FEATURES = (
    "career_games_before", "prior_season_games", "has_prior_season",
    "snap_pct_last_1", "snap_pct_last_3", "snap_pct_last_5", "snap_pct_delta_1",
    "snap_pct_trend_3", "snap_games_last_3", "snap_prior_same_team",
    "pbp_pass_attempts_l3", "pbp_pass_attempts_l5", "pbp_pass_attempts_l8",
    "pbp_pass_attempts_season_avg", "pbp_touches_l3", "pbp_touches_l5",
    "pbp_touches_l8", "pbp_touches_season_avg", "pbp_targets_l3",
    "pbp_targets_l5", "pbp_targets_l8", "pbp_targets_season_avg",
    "team_rush_share_l3", "team_rush_share_l5", "team_rush_share_l8",
    "pbp_target_share_l3", "pbp_target_share_l5", "pbp_target_share_l8",
    "position_group_snap_share_last_1", "position_group_snap_share_last_3",
)
LABELS = {0: "falling", 1: "stable", 2: "rising"}


def actual_opportunity(frame: pd.DataFrame) -> pd.Series:
    return pd.Series(np.select(
        [frame.historical_position.eq("QB"), frame.historical_position.eq("RB")],
        [frame.pbp_pass_attempts, frame.pbp_touches], default=frame.pbp_targets,
    ), index=frame.index, dtype=float)


def baseline_opportunity(frame: pd.DataFrame) -> pd.Series:
    return pd.Series(np.select(
        [frame.historical_position.eq("QB"), frame.historical_position.eq("RB")],
        [frame.pbp_pass_attempts_l8, frame.pbp_touches_l8], default=frame.pbp_targets_l8,
    ), index=frame.index, dtype=float)


def role_labels(frame: pd.DataFrame) -> pd.Series:
    actual, baseline = actual_opportunity(frame), baseline_opportunity(frame)
    minimum = pd.Series(np.select(
        [frame.historical_position.eq("QB"), frame.historical_position.eq("RB")],
        [5.0, 2.0], default=1.5,
    ), index=frame.index)
    label = pd.Series(1, index=frame.index, dtype=int)
    eligible = baseline.notna() & actual.notna()
    label.loc[eligible & actual.sub(baseline).ge(minimum) & actual.ge(baseline * 1.35)] = 2
    label.loc[eligible & baseline.sub(actual).ge(minimum) & actual.le(baseline * .70)] = 0
    return label


def main() -> None:
    frame = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string"})
    frame = frame.loc[frame.career_games_before.ge(1)].copy()
    frame["role_label"] = role_labels(frame)
    rows = []
    fold_reports = {}
    for train_end, year in ROLLING_FOLDS:
        train = frame.loc[frame.season.between(2018, train_end)]
        validation = frame.loc[frame.season.eq(year)].copy()
        model = XGBClassifier(
            objective="multi:softprob", num_class=3, n_estimators=180, max_depth=3,
            learning_rate=.04, subsample=.85, colsample_bytree=.8,
            min_child_weight=8, reg_lambda=4, n_jobs=4, random_state=RANDOM_SEED,
        )
        weights = train.role_label.map({0: 1.8, 1: .55, 2: 1.8}).to_numpy(float)
        model.fit(train[list(FEATURES)], train.role_label, sample_weight=weights)
        probabilities = model.predict_proba(validation[list(FEATURES)])
        predicted = probabilities.argmax(axis=1)
        report = classification_report(
            validation.role_label, predicted, labels=[0, 1, 2],
            target_names=[LABELS[i] for i in range(3)], output_dict=True, zero_division=0,
        )
        fold_reports[str(year)] = {
            "classification": report,
            "confusion_matrix": confusion_matrix(validation.role_label, predicted, labels=[0, 1, 2]).tolist(),
        }
        fold = validation[["player_id", "season", "week", "historical_position", "role_label"]].copy()
        fold["role_predicted"] = predicted
        for index, name in LABELS.items():
            fold[f"prob_{name}"] = probabilities[:, index]
        rows.append(fold)
    oof = pd.concat(rows, ignore_index=True)
    aggregate = classification_report(
        oof.role_label, oof.role_predicted, labels=[0, 1, 2],
        target_names=[LABELS[i] for i in range(3)], output_dict=True, zero_division=0,
    )
    report = {
        "features": list(FEATURES), "folds": fold_reports,
        "aggregate": aggregate,
        "confusion_matrix": confusion_matrix(oof.role_label, oof.role_predicted, labels=[0, 1, 2]).tolist(),
        "rows": int(len(oof)), "production_unchanged": True,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    oof.to_csv(PREDICTIONS, index=False, compression="gzip")
    print(json.dumps({"rows": len(oof), "aggregate": aggregate}, indent=2))
    print("No production or remote changes were made.")


if __name__ == "__main__":
    main()
