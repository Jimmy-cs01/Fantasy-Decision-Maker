#!/usr/bin/env python3
"""Evaluate 24-hour availability features for structural role-change prediction."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, mean_absolute_error
from xgboost import XGBClassifier, XGBRegressor

from projection_pipeline.v3_2_config import RANDOM_SEED, ROLLING_FOLDS, V3_2_FEATURE_DATASET_PATH
from train_role_change_detector_v3_4 import FEATURES as USAGE_FEATURES, role_labels

ROOT = Path(__file__).resolve().parents[1]
AVAILABILITY = ROOT / "data/processed/player_week_availability_v4_1.csv.gz"
OUTPUT = ROOT / "data/processed/model_v4_1_role_report.json"
OOF = ROOT / "data/processed/model_v4_1_role_oof.csv.gz"

AVAILABILITY_FEATURES = (
    "is_active_expected", "is_out_known", "is_questionable", "is_doubtful",
    "structurally_unavailable", "availability_observed", "availability_confidence",
    "team_changed", "weeks_since_team_change", "weeks_since_last_opportunity",
    "returning_from_injury_or_reserve", "room_active_count", "room_unavailable_count",
    "vacated_room_rush_share", "vacated_room_target_share", "top_competitor_out",
    "starter_ahead_unavailable", "depth_rank_improved", "depth_rank_declined",
    "new_starter_probability", "prior_rush_share_l3", "prior_target_share_l3",
)


def opportunity_share(frame: pd.DataFrame) -> pd.Series:
    return pd.Series(np.select(
        [frame.historical_position.eq("QB"), frame.historical_position.eq("RB")],
        [frame.pbp_pass_attempts / frame.groupby(["season", "week", "team"]).pbp_pass_attempts.transform("sum").replace(0, np.nan),
         frame.pbp_touches / frame.groupby(["season", "week", "team"]).pbp_touches.transform("sum").replace(0, np.nan)],
        default=frame.pbp_targets / frame.groupby(["season", "week", "team"]).pbp_targets.transform("sum").replace(0, np.nan),
    ), index=frame.index, dtype=float)


def model_features(frame: pd.DataFrame, columns: tuple[str, ...]) -> pd.DataFrame:
    return frame.reindex(columns=columns).apply(pd.to_numeric, errors="coerce").fillna(0)


def main() -> None:
    base = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    availability = pd.read_csv(AVAILABILITY, dtype={"player_id": "string", "team": "string"})
    keys = ["player_id", "season", "week"]
    base = base.merge(availability[keys + list(AVAILABILITY_FEATURES)], on=keys, how="left", validate="one_to_one")
    base = base.loc[base.career_games_before.ge(1)].copy()
    base["role_label"] = role_labels(base)
    base["actual_share"] = opportunity_share(base)
    prior = pd.Series(np.select(
        [base.historical_position.eq("RB"), base.historical_position.isin(["WR", "TE"])],
        [base.prior_rush_share_l3, base.prior_target_share_l3], default=np.nan,
    ), index=base.index)
    base["share_change"] = base.actual_share - prior
    variants = {
        "usage_only": tuple(USAGE_FEATURES),
        "availability": (*USAGE_FEATURES, *AVAILABILITY_FEATURES),
    }
    rows = []
    for train_end, year in ROLLING_FOLDS:
        train = base.loc[base.season.between(2018, train_end)]
        validation = base.loc[base.season.eq(year)].copy()
        fold = validation[keys + ["historical_position", "role_label", "share_change"]].copy()
        for name, features in variants.items():
            classifier = XGBClassifier(objective="multi:softprob", num_class=3, n_estimators=180,
                max_depth=3, learning_rate=.035, min_child_weight=8, subsample=.85,
                colsample_bytree=.8, reg_lambda=6, n_jobs=4, random_state=RANDOM_SEED)
            classifier.fit(model_features(train, features), train.role_label,
                sample_weight=train.role_label.map({0: 1.8, 1: .55, 2: 1.8}).to_numpy(float))
            probabilities = classifier.predict_proba(model_features(validation, features))
            fold[f"{name}_class"] = probabilities.argmax(axis=1)
            fold[f"{name}_rise_probability"] = probabilities[:, 2]
            usable = train.share_change.notna()
            regressor = XGBRegressor(objective="reg:squarederror", n_estimators=180, max_depth=3,
                learning_rate=.035, min_child_weight=10, subsample=.85, colsample_bytree=.8,
                reg_lambda=7, n_jobs=4, random_state=RANDOM_SEED)
            regressor.fit(model_features(train.loc[usable], features), train.loc[usable, "share_change"])
            fold[f"{name}_share_change"] = regressor.predict(model_features(validation, features))
        rows.append(fold)
    oof = pd.concat(rows, ignore_index=True)
    report = {"rows": len(oof), "cutoff_hours": 24, "production_unchanged": True, "variants": {}}
    for name in variants:
        valid_change = oof.share_change.notna()
        large_rise = oof.share_change.ge(.10)
        predicted_rise = oof[f"{name}_share_change"].ge(.10)
        report["variants"][name] = {
            "classification": classification_report(oof.role_label, oof[f"{name}_class"], output_dict=True, zero_division=0),
            "share_change_mae": round(mean_absolute_error(oof.loc[valid_change, "share_change"], oof.loc[valid_change, f"{name}_share_change"]), 6),
            "large_rise_precision": round(float((large_rise & predicted_rise).sum() / max(1, predicted_rise.sum())), 6),
            "large_rise_recall": round(float((large_rise & predicted_rise).sum() / max(1, large_rise.sum())), 6),
        }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    oof.to_csv(OOF, index=False, compression="gzip")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
