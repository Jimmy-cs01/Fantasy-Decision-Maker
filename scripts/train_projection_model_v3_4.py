#!/usr/bin/env python3
"""Local-only v3.4 learned-share tournament; never writes production data."""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from audit_projection_opportunity_v3_3_2 import allocation_metrics, cohort_metrics, finalize
from projection_pipeline.config import DIRECT_TARGET
from projection_pipeline.evaluation_scoreboard import chronological_quantile_calibration, regression_metrics
from projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR
from projection_pipeline.v3_1_model import predict_coherent_candidate
from projection_pipeline.v3_2_config import RANDOM_SEED, ROLLING_FOLDS, V3_2_ARTIFACT_DIR, V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v3_2_model import role_confidence_with_snaps
from projection_pipeline.v3_4_model import LearnedShareConfig, learned_share_allocator
from train_projection_model_v3_2 import train_components
from experiment_team_volume_v3_4 import FEATURES as TEAM_FEATURES, team_frame


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/model_v3_4_experiment_report.json"
OOF = ROOT / "data/processed/model_v3_4_oof.csv.gz"
ROLE_OOF = ROOT / "data/processed/v3_4_role_detector_oof.csv.gz"
SHARE_FEATURES = [
    "career_games_before", "prior_season_games", "prior_season_rush_attempts_pg",
    "prior_season_targets_pg", "snap_pct_last_1", "snap_pct_last_3", "snap_pct_last_5",
    "snap_pct_delta_1", "snap_pct_trend_3", "position_group_snap_share_last_1",
    "position_group_snap_share_last_3", "team_rush_share_l3", "team_rush_share_l5",
    "team_rush_share_l8", "backfield_rush_share_l3", "backfield_rush_share_l5",
    "pbp_target_share_l3", "pbp_target_share_l5", "pbp_target_share_l8",
    "backfield_target_share_l3", "backfield_target_share_l5",
]
EXPERIMENTS = {
    "learned_25": LearnedShareConfig(.25),
    "learned_50": LearnedShareConfig(.50),
    "learned_75": LearnedShareConfig(.75),
    "conditional_50": LearnedShareConfig(.50, .50),
    "team_volume": LearnedShareConfig(0.0, None, 0.0, True),
    "team_volume_learned_25": LearnedShareConfig(.25, None, 0.0, True),
    "team_volume_25": LearnedShareConfig(0.0, None, 0.0, True, .25),
    "team_volume_50": LearnedShareConfig(0.0, None, 0.0, True, .50),
    "team_volume_25_learned_25": LearnedShareConfig(.25, None, 0.0, True, .25),
}


def fit_share_models(train: pd.DataFrame):
    models = {}
    params = dict(
        objective="reg:squarederror", n_estimators=220, max_depth=3, learning_rate=.035,
        min_child_weight=10, subsample=.85, colsample_bytree=.8, reg_lambda=5,
        n_jobs=4, random_state=RANDOM_SEED,
    )
    for position in ("RB", "WR", "TE"):
        rows = train.loc[train.historical_position.eq(position)]
        target = "team_rush_share" if position == "RB" else None
        if target:
            usable = rows.loc[rows[target].notna()]
            model = XGBRegressor(**params).fit(usable[SHARE_FEATURES], usable[target])
            models[(position, "rush")] = model
        usable = rows.loc[rows.pbp_target_share.notna()]
        models[(position, "target")] = XGBRegressor(**params).fit(
            usable[SHARE_FEATURES], usable.pbp_target_share,
        )
    return models


def add_share_predictions(frame: pd.DataFrame, models) -> pd.DataFrame:
    output = frame.copy()
    output["_learned_target_share"] = 0.0
    output["_learned_rush_share"] = 0.0
    for position, indices in output.groupby("historical_position").groups.items():
        idx = list(indices)
        if (position, "target") in models:
            output.loc[idx, "_learned_target_share"] = np.maximum(0, models[(position, "target")].predict(output.loc[idx, SHARE_FEATURES]))
        if (position, "rush") in models:
            output.loc[idx, "_learned_rush_share"] = np.maximum(0, models[(position, "rush")].predict(output.loc[idx, SHARE_FEATURES]))
    return output


def fit_team_models(train: pd.DataFrame):
    teams = team_frame(train)
    params = dict(
        objective="reg:squarederror", n_estimators=220, max_depth=3, learning_rate=.035,
        min_child_weight=12, subsample=.85, colsample_bytree=.8, reg_lambda=6,
        n_jobs=4, random_state=RANDOM_SEED,
    )
    return {
        short: XGBRegressor(**params).fit(teams[TEAM_FEATURES], teams[target])
        for target, short in (("actual_pass_attempts", "pass"), ("actual_rush_attempts", "rush"), ("actual_targets", "target"))
    }


def add_team_predictions(frame: pd.DataFrame, models) -> pd.DataFrame:
    output = frame.copy()
    keys = ["season", "week", "team"]
    teams = output.groupby(keys, as_index=False).first()
    for short, model in models.items():
        teams[f"_team_{short}_budget"] = np.maximum(0, model.predict(teams[TEAM_FEATURES]))
    return output.merge(teams[keys + ["_team_pass_budget", "_team_rush_budget", "_team_target_budget"]], on=keys, how="left", validate="many_to_one")


def main() -> None:
    started = time.perf_counter()
    frame = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    frame = frame.loc[frame.career_games_before.ge(1)].copy()
    v31_manifest = json.loads((V3_1_ARTIFACT_DIR / "manifest.json").read_text())
    v32_manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    features = {position: details["features"] for position, details in v32_manifest["models"].items()}
    direct_weights = v32_manifest["direct_weights"]
    baseline = pd.read_csv(V3_2_ARTIFACT_DIR.parent / "v3_3_2/rolling_validation_predictions.csv.gz", dtype={"player_id": "string"})
    roles = pd.read_csv(ROLE_OOF, dtype={"player_id": "string"})
    keys = ["player_id", "season", "week", "historical_position"]
    folds = []
    for train_end, year in ROLLING_FOLDS:
        print(f"v3.4 share fold {year}", flush=True)
        train = frame.loc[frame.season.between(2018, train_end)]
        validation = frame.loc[frame.season.eq(year)].reset_index(drop=True)
        share_models = fit_share_models(train)
        validation = add_share_predictions(validation, share_models)
        validation = add_team_predictions(validation, fit_team_models(train))
        role = roles.loc[roles.season.eq(year), keys + ["prob_rising", "prob_falling"]]
        validation = validation.merge(role, on=keys, how="left", validate="one_to_one").rename(columns={
            "prob_rising": "_prob_rising", "prob_falling": "_prob_falling",
        })
        component_models = train_components(train, features, v31_manifest["hyperparameters"])
        aligned = validation[keys].merge(
            baseline.loc[baseline.season.eq(year), keys + ["v3_1", "e6_tail_safety_rising_role"]],
            on=keys, how="left", validate="one_to_one",
        )
        fold = validation.copy()
        fold["v3_1"] = aligned.v3_1.to_numpy(float)
        fold["v3_3_2"] = aligned.e6_tail_safety_rising_role.to_numpy(float)
        for name, config in EXPERIMENTS.items():
            candidate = predict_coherent_candidate(
                validation, component_models, features, direct_weights,
                role_confidence_fn=role_confidence_with_snaps,
                refill_budget=True, refill_week_one_only=True, current_qb_depth_gate=True,
                robust_week_one_context=True, passing_hierarchy_fn=learned_share_allocator(config),
            )
            rising_candidate = predict_coherent_candidate(
                validation, component_models, features, direct_weights,
                role_confidence_fn=role_confidence_with_snaps,
                refill_budget=True, refill_week_one_only=True, current_qb_depth_gate=True,
                robust_week_one_context=True,
                passing_hierarchy_fn=learned_share_allocator(LearnedShareConfig(
                    config.learned_weight, config.role_threshold, 1.0, config.use_learned_team_volume,
                    config.team_volume_weight,
                )),
            )
            fold[name], components = finalize(validation, candidate, rising_candidate, fold.v3_1.to_numpy(float))
            fold[f"_{name}_components"] = components
        folds.append(fold)
    oof = pd.concat(folds, ignore_index=True)
    names = ["v3_3_2", *EXPERIMENTS]
    report = {
        "status": "experimental_local_only", "architecture": "learned team shares; assigned volume preserved",
        "overall": {name: regression_metrics(oof[DIRECT_TARGET], oof[name]) for name in names},
        "folds": {str(year): {name: regression_metrics(group[DIRECT_TARGET], group[name]) for name in names} for year, group in oof.groupby("season")},
        "positions": {position: {name: regression_metrics(group[DIRECT_TARGET], group[name]) for name in names} for position, group in oof.groupby("historical_position")},
        "cohorts": {name: cohort_metrics(oof, name) for name in names},
        "allocation": {name: allocation_metrics(oof, f"_{name}_components") for name in EXPERIMENTS},
        "calibration": {name: chronological_quantile_calibration(oof, name) for name in names},
        "runtime_seconds": round(time.perf_counter() - started, 3), "production_unchanged": True,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    oof.drop(columns=[c for c in oof if c.startswith("_")]).to_csv(OOF, index=False, compression="gzip")
    print(json.dumps(report["overall"], indent=2))
    print("No production or remote changes were made.")


if __name__ == "__main__":
    main()
