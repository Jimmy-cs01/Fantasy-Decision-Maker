#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

if __package__:
    from .projection_pipeline.config import DIRECT_TARGET, FANTASY_POSITIONS, STAT_TARGETS_BY_POSITION
    from .projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR
    from .projection_pipeline.v3_1_model import add_error_slices, bootstrap_mae_difference, predict_coherent_candidate, write_json
    from .projection_pipeline.v3_2_config import (
        BOOTSTRAP_SAMPLES, ENSEMBLE_WEIGHTS, RANDOM_SEED, ROLLING_FOLDS,
        SNAP_EXPERIMENTS, V3_2_ARTIFACT_DIR, V3_2_EXPERIMENT_REPORT_PATH,
        V3_2_FEATURE_DATASET_PATH, V3_2_FEATURE_VERSION,
    )
    from .projection_pipeline.v3_2_model import role_confidence_with_snaps
    from .projection_pipeline.v3_model import metric_set
else:
    from projection_pipeline.config import DIRECT_TARGET, FANTASY_POSITIONS, STAT_TARGETS_BY_POSITION
    from projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR
    from projection_pipeline.v3_1_model import add_error_slices, bootstrap_mae_difference, predict_coherent_candidate, write_json
    from projection_pipeline.v3_2_config import (
        BOOTSTRAP_SAMPLES, ENSEMBLE_WEIGHTS, RANDOM_SEED, ROLLING_FOLDS,
        SNAP_EXPERIMENTS, V3_2_ARTIFACT_DIR, V3_2_EXPERIMENT_REPORT_PATH,
        V3_2_FEATURE_DATASET_PATH, V3_2_FEATURE_VERSION,
    )
    from projection_pipeline.v3_2_model import role_confidence_with_snaps
    from projection_pipeline.v3_model import metric_set


def model(params: dict) -> XGBRegressor:
    return XGBRegressor(**params, objective="reg:squarederror", eval_metric="mae", n_jobs=4, random_state=RANDOM_SEED)


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    result = metric_set(actual, predicted)
    result["bias"] = round(float(np.mean(predicted - actual)), 4)
    return result


def train_direct(train: pd.DataFrame, validation: pd.DataFrame, features: dict[str, list[str]], params: dict) -> np.ndarray:
    output = np.zeros(len(validation))
    indexed = validation.reset_index(drop=True)
    for position, indices in indexed.groupby("historical_position").groups.items():
        idx = list(indices)
        cohort = train.loc[train["historical_position"].eq(position)]
        fitted = model(params)
        fitted.fit(cohort[features[position]], cohort[DIRECT_TARGET])
        output[idx] = np.maximum(0, fitted.predict(indexed.loc[idx, features[position]]))
    return output


def train_components(train: pd.DataFrame, features: dict[str, list[str]], params: dict) -> dict[str, dict[str, XGBRegressor]]:
    output: dict[str, dict[str, XGBRegressor]] = {}
    for position in FANTASY_POSITIONS:
        cohort = train.loc[train["historical_position"].eq(position)]
        output[position] = {}
        for target in [DIRECT_TARGET, *STAT_TARGETS_BY_POSITION[position]]:
            usable = cohort.loc[cohort[target].notna()]
            fitted = model(params)
            fitted.fit(usable[features[position]], usable[target])
            output[position][target] = fitted
    return output


def direct_blend(candidate, frame: pd.DataFrame, direct_weights: dict[str, float]) -> np.ndarray:
    from projection_pipeline.v3_1_model import sample_weight
    from projection_pipeline.v3_model import component_ppr
    components = {name: np.array([row.get(name, 0.0) for row in candidate.components]) for name in set().union(*(row.keys() for row in candidate.components))}
    component = component_ppr(components, len(frame))
    output = np.zeros(len(frame))
    indexed = frame.reset_index(drop=True)
    for position, indices in indexed.groupby("historical_position").groups.items():
        idx = list(indices)
        sparse = np.array([sample_weight(indexed.loc[i], position) for i in idx])
        effective = float(direct_weights[position]) * (0.25 + 0.75 * sparse)
        output[idx] = component[idx] * (1 - effective) + candidate.direct[idx] * effective
    return output


def select_weight(actual: np.ndarray, baseline: np.ndarray, candidate: np.ndarray) -> float:
    return min(ENSEMBLE_WEIGHTS, key=lambda weight: float(np.mean(np.abs(actual - (baseline * (1 - weight) + candidate * weight)))))


def slice_report(frame: pd.DataFrame, names: list[str]) -> dict:
    sliced = add_error_slices(frame)
    recent_snap = sliced["snap_pct_last_1"]
    baseline_snap = sliced["snap_pct_last_3"]
    definitions = {
        "role_increase": (recent_snap - baseline_snap).ge(0.15),
        "role_decrease": (recent_snap - baseline_snap).le(-0.15),
        "low_history": sliced["career_games_before"].fillna(0).le(8),
        "rookie_young": sliced["experience_bucket"].isin(["rookie", "young"]),
        "established_elite": sliced["established_elite"],
        "backup": ~sliced["starter_proxy"],
        "starter": sliced["starter_proxy"],
        "extreme_td_prior": sliced["extreme_td_prior"],
    }
    return {
        name: {
            model_name: metrics(group[DIRECT_TARGET].to_numpy(), group[model_name].to_numpy())
            for model_name in names
        } | {"rows": int(len(group))}
        for name, mask in definitions.items()
        if len(group := sliced.loc[mask])
    }


def coherence_violations(audit: pd.DataFrame) -> dict[str, int]:
    toler = 1e-6
    return {
        "target_budget": int((audit["targets_after"] > audit["target_budget"] + toler).sum()),
        "rb_carry_budget": int((audit["rb_carries_after"] > audit["rb_carry_budget"] + toler).sum()),
        "pass_attempt_budget": int((audit["pass_attempts_after"] > audit["pass_attempt_budget"] + toler).sum()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Rolling chronological Model v3.2 snap experiments; local only.")
    parser.add_argument("--features", type=Path, default=V3_2_FEATURE_DATASET_PATH)
    parser.add_argument("--artifact-dir", type=Path, default=V3_2_ARTIFACT_DIR)
    args = parser.parse_args()
    started = time.perf_counter()
    frame = pd.read_csv(args.features, dtype={"player_id": "string", "team": "string"})
    frame = frame.loc[frame["career_games_before"].ge(1)].copy()
    v31_manifest = json.loads((V3_1_ARTIFACT_DIR / "manifest.json").read_text())
    base_features = {position: details["features"] for position, details in v31_manifest["positions"].items()}
    params = v31_manifest["hyperparameters"]
    direct_weights = v31_manifest["direct_weights"]

    # Stage 1: inexpensive direct-model ablation on every chronological fold.
    experiment_rows: list[dict] = []
    for train_end, validation_year in ROLLING_FOLDS:
        train = frame.loc[frame["season"].between(2018, train_end)]
        validation = frame.loc[frame["season"].eq(validation_year)].reset_index(drop=True)
        actual = validation[DIRECT_TARGET].to_numpy()
        for name, snap_features in SNAP_EXPERIMENTS.items():
            feature_map = {position: [*base_features[position], *snap_features] for position in FANTASY_POSITIONS}
            predicted = train_direct(train, validation, feature_map, params)
            experiment_rows.append({"experiment": name, "train_end": train_end, "validation_year": validation_year, **metrics(actual, predicted)})
    experiments = pd.DataFrame(experiment_rows)
    aggregate = experiments.groupby("experiment", as_index=False).agg(rows=("rows", "sum"), mae=("mae", "mean"), rmse=("rmse", "mean"), correlation=("correlation", "mean"), r2=("r2", "mean"), bias=("bias", "mean"))
    selected_name = aggregate.sort_values(["mae", "experiment"]).iloc[0]["experiment"]
    selected_snap_features = list(SNAP_EXPERIMENTS[str(selected_name)])
    selected_features = {position: [*base_features[position], *selected_snap_features] for position in FANTASY_POSITIONS}

    # Stage 2: retrain the complete opportunity/component architecture for the
    # baseline and selected snap candidate on the same rolling folds.
    predictions: list[pd.DataFrame] = []
    coherence: list[dict] = []
    for train_end, validation_year in ROLLING_FOLDS:
        train = frame.loc[frame["season"].between(2018, train_end)]
        validation = frame.loc[frame["season"].eq(validation_year)].reset_index(drop=True)
        baseline_models = train_components(train, base_features, params)
        snap_models = train_components(train, selected_features, params)
        baseline_candidate = predict_coherent_candidate(validation, baseline_models, base_features)
        snap_candidate = predict_coherent_candidate(validation, snap_models, selected_features, role_confidence_fn=role_confidence_with_snaps)
        baseline = direct_blend(baseline_candidate, validation, direct_weights)
        snap = direct_blend(snap_candidate, validation, direct_weights)
        report_columns = [
            "player_id", "season", "week", "team", "historical_position", DIRECT_TARGET,
            "career_games_before", "snap_pct_last_1", "snap_pct_last_3",
            "prior_season_true_touches_pg", "prior_season_targets_pg", "prior_season_games",
            "prior_season_position_rank_pct", "rushing_touchdowns_season_avg",
            "rush_attempts_season_avg", "passing_td_rate_season", "receiving_td_rate_season",
            "pbp_pass_attempts_l3", "pbp_pass_attempts_season_avg",
            "pbp_touches_l3", "pbp_touches_season_avg",
            "pbp_targets_l3", "pbp_targets_season_avg",
        ]
        fold = validation[report_columns].copy()
        fold["v3_1"] = baseline
        fold["v3_2"] = snap
        predictions.append(fold)
        coherence.append({"validation_year": validation_year, "v3_1": coherence_violations(baseline_candidate.audit), "v3_2": coherence_violations(snap_candidate.audit)})

    oof = pd.concat(predictions, ignore_index=True)
    actual = oof[DIRECT_TARGET].to_numpy()
    baseline = oof["v3_1"].to_numpy()
    snap = oof["v3_2"].to_numpy()
    global_weight = select_weight(actual, baseline, snap)
    position_weights = {
        position: select_weight(group[DIRECT_TARGET].to_numpy(), group["v3_1"].to_numpy(), group["v3_2"].to_numpy())
        for position, group in oof.groupby("historical_position")
    }
    oof["global_ensemble"] = baseline * (1 - global_weight) + snap * global_weight
    oof["position_ensemble"] = [
        row.v3_1 * (1 - position_weights[row.historical_position]) + row.v3_2 * position_weights[row.historical_position]
        for row in oof.itertuples()
    ]
    candidates = ["v3_1", "v3_2", "global_ensemble", "position_ensemble"]
    overall = {name: metrics(actual, oof[name].to_numpy()) for name in candidates}
    selected_candidate = min((name for name in candidates if name != "v3_1"), key=lambda name: overall[name]["mae"])
    bootstrap = bootstrap_mae_difference(actual, baseline, oof[selected_candidate].to_numpy())
    position = {
        position_name: {name: metrics(group[DIRECT_TARGET].to_numpy(), group[name].to_numpy()) for name in candidates}
        for position_name, group in oof.groupby("historical_position")
    }
    slices = slice_report(oof, candidates)
    fold_metrics = {
        str(year): {name: metrics(group[DIRECT_TARGET].to_numpy(), group[name].to_numpy()) for name in candidates}
        for year, group in oof.groupby("season")
    }
    improvement = overall["v3_1"]["mae"] - overall[selected_candidate]["mae"]
    consistent_folds = sum(fold_metrics[str(year)][selected_candidate]["mae"] <= fold_metrics[str(year)]["v3_1"]["mae"] for _, year in ROLLING_FOLDS)
    material_position_worsening = any(position[pos][selected_candidate]["mae"] - position[pos]["v3_1"]["mae"] > 0.08 for pos in position)
    coherent = all(sum(entry["v3_2"].values()) == 0 for entry in coherence)
    promotion_recommended = bool(
        improvement > 0
        and (improvement / overall["v3_1"]["mae"] >= 0.01 or bootstrap["upper_95"] < 0)
        and consistent_folds >= 3
        and not material_position_worsening
        and coherent
    )

    # Fit the frozen selected pure v3.2 architecture on every completed season.
    # Promotion remains a separate, explicit step after current-player sanity.
    production_train = frame.loc[frame["season"].between(2018, 2025)]
    final_models = train_components(production_train, selected_features, params)
    args.artifact_dir.mkdir(parents=True, exist_ok=True)
    positions: dict[str, dict] = {}
    importance: dict[str, dict[str, float]] = {}
    for position_name, models in final_models.items():
        files = {}
        importance[position_name] = {}
        for target, fitted in models.items():
            filename = f"{position_name.lower()}__{target}.ubj"
            fitted.save_model(args.artifact_dir / filename)
            files[target] = filename
            if target == DIRECT_TARGET:
                for feature, value in zip(selected_features[position_name], fitted.feature_importances_, strict=True):
                    if feature in selected_snap_features:
                        importance[position_name][feature] = round(float(value), 7)
        positions[position_name] = {"features": selected_features[position_name], "models": files}

    report = {
        "version": "v3_2", "status": "experimental", "feature_version": V3_2_FEATURE_VERSION,
        "created_at": datetime.now(UTC).isoformat(), "random_seed": RANDOM_SEED,
        "rolling_folds": [{"train": [2018, train_end], "validate": year} for train_end, year in ROLLING_FOLDS],
        "experiment_metrics": experiment_rows, "experiment_aggregate": aggregate.to_dict("records"),
        "selected_snap_experiment": selected_name, "selected_snap_features": selected_snap_features,
        "overall": overall, "folds": fold_metrics, "positions": position, "slices": slices,
        "global_ensemble_weight_v3_2": global_weight, "position_ensemble_weights_v3_2": position_weights,
        "selected_candidate": selected_candidate, "bootstrap_candidate_minus_v3_1": bootstrap,
        "team_coherence": coherence, "snap_feature_importance": importance,
        "promotion_preliminary": promotion_recommended,
        "promotion_gate_details": {"mae_improvement": round(improvement, 4), "consistent_folds": consistent_folds, "material_position_worsening": material_position_worsening, "coherent": coherent},
        "training_range": [2018, 2025], "hyperparameters": params, "direct_weights": direct_weights,
        "models": positions, "runtime_seconds": round(time.perf_counter() - started, 3),
    }
    write_json(args.artifact_dir / "manifest.json", report)
    write_json(V3_2_EXPERIMENT_REPORT_PATH, report)
    oof.to_csv(args.artifact_dir / "rolling_validation_predictions.csv.gz", index=False, compression="gzip")
    print(json.dumps({key: report[key] for key in ["selected_snap_experiment", "selected_snap_features", "overall", "folds", "global_ensemble_weight_v3_2", "position_ensemble_weights_v3_2", "selected_candidate", "bootstrap_candidate_minus_v3_1", "promotion_preliminary", "promotion_gate_details", "runtime_seconds"]}, indent=2))
    print("No Supabase or production projection rows were written.")


if __name__ == "__main__":
    main()
