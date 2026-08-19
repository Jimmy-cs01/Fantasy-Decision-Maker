#!/usr/bin/env python3
"""Leakage-safe, local-only role/opportunity experiments on production v3.3.2.

Sleeper is intentionally absent: actual historical outcomes select candidates.
No artifact in this script is eligible for production activation.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from projection_pipeline.config import DIRECT_TARGET
from projection_pipeline.evaluation_scoreboard import (
    chronological_quantile_calibration,
    regression_metrics,
    role_change_report,
    role_change_masks,
)
from projection_pipeline.scoring import score_projected_stats_exact
from projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR
from projection_pipeline.v3_1_model import predict_coherent_candidate
from projection_pipeline.v3_2_config import ROLLING_FOLDS, V3_2_ARTIFACT_DIR, V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v3_2_model import role_confidence_with_snaps
from projection_pipeline.v3_3_1_model import apply_protective_role_corrections
from projection_pipeline.v3_3_2_config import TAIL_SAFETY_WEIGHT
from projection_pipeline.v3_3_2_model import direct_safety_eligible_mask
from projection_pipeline.v3_3_2_role_experiment import RoleShareConfig, role_share_allocator
from train_projection_model_v3_2 import train_components
from train_projection_model_v3_3 import exact_component_predictions


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/v3_3_2_opportunity_audit.json"
OOF_OUTPUT = ROOT / "data/processed/v3_3_2_opportunity_experiments.csv.gz"
EXPERIMENTS = {
    "targets_share": RoleShareConfig(refill_targets=True, refill_rb_carries=False),
    "rb_share": RoleShareConfig(refill_targets=False, refill_rb_carries=True),
    "all_shares": RoleShareConfig(refill_targets=True, refill_rb_carries=True),
    "all_shares_qb_rush": RoleShareConfig(
        refill_targets=True, refill_rb_carries=True, qb_rush_archetype_weight=0.35,
    ),
}


def finalize(frame: pd.DataFrame, candidate, rising_candidate, v31: np.ndarray) -> tuple[np.ndarray, list[dict[str, float]]]:
    base_corrected, _ = apply_protective_role_corrections(frame, v31, candidate.predictions)
    rising_corrected, _ = apply_protective_role_corrections(frame, v31, rising_candidate.predictions)
    target = (1 - TAIL_SAFETY_WEIGHT) * base_corrected + TAIL_SAFETY_WEIGHT * candidate.direct
    rising = role_change_masks(frame)[0].to_numpy()
    target[rising] = rising_corrected[rising]
    ineligible = ~direct_safety_eligible_mask(frame)
    target[ineligible] = base_corrected[ineligible]
    components = [dict(values) for values in candidate.components]
    prediction, reconciled, _ = exact_component_predictions(components, target, frame.historical_position)
    return prediction, reconciled


def allocation_metrics(frame: pd.DataFrame, component_column: str) -> dict[str, float | int]:
    work = frame.copy()
    components = work[component_column]
    work["pred_targets"] = [float(row.get("targets", 0)) for row in components]
    work["pred_carries"] = [float(row.get("rush_attempts", 0)) for row in components]
    actual_targets = pd.to_numeric(work.get("pbp_targets", work.get("targets", 0)), errors="coerce").fillna(0)
    actual_carries = pd.to_numeric(work.get("pbp_rush_attempts", work.get("rush_attempts", 0)), errors="coerce").fillna(0)
    work["actual_targets"] = actual_targets
    work["actual_carries"] = actual_carries
    groups = work.groupby(["season", "week", "team"], dropna=False)
    work["actual_team_targets"] = groups.actual_targets.transform("sum")
    work["pred_team_targets"] = groups.pred_targets.transform("sum")
    rb = work.historical_position.eq("RB")
    work["actual_rb_carries"] = actual_carries.where(rb, 0)
    work["pred_rb_carries"] = work.pred_carries.where(rb, 0)
    work["actual_team_rb_carries"] = groups.actual_rb_carries.transform("sum")
    work["pred_team_rb_carries"] = groups.pred_rb_carries.transform("sum")
    eligible_targets = work.actual_team_targets.gt(0)
    eligible_carries = rb & work.actual_team_rb_carries.gt(0)
    target_share_error = (
        work.loc[eligible_targets, "pred_targets"].div(work.loc[eligible_targets, "pred_team_targets"].replace(0, np.nan))
        - work.loc[eligible_targets, "actual_targets"].div(work.loc[eligible_targets, "actual_team_targets"])
    ).abs()
    carry_share_error = (
        work.loc[eligible_carries, "pred_rb_carries"].div(work.loc[eligible_carries, "pred_team_rb_carries"].replace(0, np.nan))
        - work.loc[eligible_carries, "actual_rb_carries"].div(work.loc[eligible_carries, "actual_team_rb_carries"])
    ).abs()
    team = work.drop_duplicates(["season", "week", "team"])
    return {
        "player_target_share_mae": float(target_share_error.mean()),
        "rb_rush_share_mae": float(carry_share_error.mean()),
        "team_target_mae": float((team.pred_team_targets - team.actual_team_targets).abs().mean()),
        "team_rb_carry_mae": float((team.pred_team_rb_carries - team.actual_team_rb_carries).abs().mean()),
    }


def cohort_metrics(frame: pd.DataFrame, prediction: str) -> dict[str, object]:
    output: dict[str, object] = {}
    position = frame.historical_position
    prior_rush = pd.to_numeric(frame.prior_season_rush_attempts_pg, errors="coerce").fillna(0)
    prior_targets = pd.to_numeric(frame.prior_season_targets_pg, errors="coerce").fillna(0)
    career = pd.to_numeric(frame.career_games_before, errors="coerce").fillna(0)
    masks = {
        "high_volume_rb": position.eq("RB") & prior_rush.ge(12),
        "high_rush_qb": position.eq("QB") & prior_rush.ge(5),
        "high_volume_receiver": position.isin(["WR", "TE"]) & prior_targets.ge(7),
        "low_history": career.le(8),
        "rookie_young": career.le(16),
    }
    for name, mask in masks.items():
        selected = frame.loc[mask]
        output[name] = regression_metrics(selected[DIRECT_TARGET].to_numpy(), selected[prediction].to_numpy())
    output["role_change"] = role_change_report(frame, prediction)
    return output


def main() -> None:
    started = time.perf_counter()
    frame = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    frame = frame.loc[frame.career_games_before.ge(1)].copy()
    v31_manifest = json.loads((V3_1_ARTIFACT_DIR / "manifest.json").read_text())
    v32_manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    features = {position: detail["features"] for position, detail in v32_manifest["models"].items()}
    params = v31_manifest["hyperparameters"]
    direct_weights = v32_manifest["direct_weights"]
    baseline = pd.read_csv(
        V3_2_ARTIFACT_DIR.parent / "v3_3_2" / "rolling_validation_predictions.csv.gz",
        dtype={"player_id": "string"},
    )
    keys = ["player_id", "season", "week", "historical_position"]
    folds: list[pd.DataFrame] = []
    for train_end, validation_year in ROLLING_FOLDS:
        print(f"Training cached architecture through {train_end}; validating {validation_year}...", flush=True)
        train = frame.loc[frame.season.between(2018, train_end)]
        validation = frame.loc[frame.season.eq(validation_year)].reset_index(drop=True)
        models = train_components(train, features, params)
        aligned = validation[keys].merge(
            baseline.loc[baseline.season.eq(validation_year), keys + ["v3_1", "e6_tail_safety_rising_role"]],
            on=keys, how="left", validate="one_to_one",
        )
        fold = validation.copy()
        fold["v3_1"] = aligned.v3_1.to_numpy(float)
        fold["v3_3_2"] = aligned.e6_tail_safety_rising_role.to_numpy(float)
        for name, config in EXPERIMENTS.items():
            candidate = predict_coherent_candidate(
                validation, models, features, direct_weights,
                role_confidence_fn=role_confidence_with_snaps,
                refill_budget=True, refill_week_one_only=True,
                current_qb_depth_gate=True, robust_week_one_context=True,
                passing_hierarchy_fn=role_share_allocator(config),
            )
            rising_config = RoleShareConfig(**{
                **config.__dict__, "qb_environment_refill": 1.0,
            })
            rising_candidate = predict_coherent_candidate(
                validation, models, features, direct_weights,
                role_confidence_fn=role_confidence_with_snaps,
                refill_budget=True, refill_week_one_only=True,
                current_qb_depth_gate=True, robust_week_one_context=True,
                passing_hierarchy_fn=role_share_allocator(rising_config),
            )
            fold[name], reconciled = finalize(
                validation, candidate, rising_candidate, fold.v3_1.to_numpy(float),
            )
            fold[f"_{name}_components"] = reconciled
        folds.append(fold)
    oof = pd.concat(folds, ignore_index=True)
    names = ["v3_3_2", *EXPERIMENTS]
    report = {
        "status": "local_experiment_only",
        "selection_target": "historical actual PPR; Sleeper excluded",
        "folds": [{"train": [2018, end], "validate": year} for end, year in ROLLING_FOLDS],
        "overall": {
            name: regression_metrics(oof[DIRECT_TARGET].to_numpy(), oof[name].to_numpy()) for name in names
        },
        "fold_metrics": {
            str(int(year)): {
                name: regression_metrics(group[DIRECT_TARGET].to_numpy(), group[name].to_numpy())
                for name in names
            }
            for year, group in oof.groupby("season")
        },
        "positions": {
            position: {
                name: regression_metrics(group[DIRECT_TARGET].to_numpy(), group[name].to_numpy()) for name in names
            } for position, group in oof.groupby("historical_position")
        },
        "cohorts": {name: cohort_metrics(oof, name) for name in names},
        "calibration": {
            name: chronological_quantile_calibration(oof, name) for name in names
        },
        "allocation": {
            name: allocation_metrics(oof, f"_{name}_components") for name in EXPERIMENTS
        },
        "runtime_seconds": round(time.perf_counter() - started, 3),
        "production_unchanged": True,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    oof.drop(columns=[column for column in oof if column.startswith("_")]).to_csv(
        OOF_OUTPUT, index=False, compression="gzip",
    )
    print(json.dumps(report, indent=2))
    print("No Supabase, Vercel, environment, or active-model changes were made.")


if __name__ == "__main__":
    main()
