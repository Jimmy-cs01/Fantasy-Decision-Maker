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
    from .projection_pipeline.config import ARTIFACT_ROOT, DIRECT_TARGET, FEATURE_COLUMNS, FANTASY_POSITIONS, STAT_TARGETS_BY_POSITION
    from .projection_pipeline.model import load_bundle
    from .projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR, V3_1_ERROR_REPORT_PATH, V3_1_EXPERIMENT_REPORT_PATH, V3_1_FEATURE_VERSION
    from .projection_pipeline.v3_1_model import (
        add_error_slices, bootstrap_mae_difference, error_analysis, load_position_models,
        opportunity_feature_subset, predict_coherent_candidate, sample_weight, select_ensemble_weight, write_json,
    )
    from .projection_pipeline.v3_config import V3_FEATURE_COLUMNS_BY_POSITION, V3_FEATURE_DATASET_PATH
    from .projection_pipeline.v3_model import component_ppr, load_v3_bundle, metric_set, predict_v3_targets
else:
    from projection_pipeline.config import ARTIFACT_ROOT, DIRECT_TARGET, FEATURE_COLUMNS, FANTASY_POSITIONS, STAT_TARGETS_BY_POSITION
    from projection_pipeline.model import load_bundle
    from projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR, V3_1_ERROR_REPORT_PATH, V3_1_EXPERIMENT_REPORT_PATH, V3_1_FEATURE_VERSION
    from projection_pipeline.v3_1_model import (
        add_error_slices, bootstrap_mae_difference, error_analysis, load_position_models,
        opportunity_feature_subset, predict_coherent_candidate, sample_weight, select_ensemble_weight, write_json,
    )
    from projection_pipeline.v3_config import V3_FEATURE_COLUMNS_BY_POSITION, V3_FEATURE_DATASET_PATH
    from projection_pipeline.v3_model import component_ppr, load_v3_bundle, metric_set, predict_v3_targets


BASE_PARAMS = {
    "n_estimators": 240, "max_depth": 4, "learning_rate": 0.04,
    "min_child_weight": 8, "subsample": 0.85, "colsample_bytree": 0.85,
    "reg_lambda": 1.0, "reg_alpha": 0.0,
}
PARAMETER_CANDIDATES = [
    BASE_PARAMS,
    {**BASE_PARAMS, "max_depth": 3, "min_child_weight": 12, "reg_lambda": 2.0},
    {**BASE_PARAMS, "max_depth": 3, "learning_rate": 0.03, "n_estimators": 300, "subsample": 0.9, "colsample_bytree": 0.75, "reg_lambda": 3.0, "reg_alpha": 0.05},
]


def regressor(params: dict) -> XGBRegressor:
    return XGBRegressor(**params, objective="reg:squarederror", eval_metric="mae", n_jobs=4, random_state=42)


def with_bias(actual: np.ndarray, predicted: np.ndarray) -> dict:
    result = metric_set(actual, predicted)
    result["bias"] = round(float(np.mean(predicted - actual)), 4)
    return result


def original_v3_prediction(frame: pd.DataFrame, manifest: dict, models: dict) -> np.ndarray:
    output = np.zeros(len(frame))
    indexed = frame.reset_index(drop=True)
    for position, indices in indexed.groupby("historical_position").groups.items():
        idx = list(indices)
        rows = indexed.loc[idx]
        arrays = predict_v3_targets(models[position], rows, manifest["positions"][position]["features"])
        direct = arrays[DIRECT_TARGET]
        component = component_ppr(arrays, len(rows))
        weight = float(manifest["positions"][position].get("component_ppr_weight", 0))
        output[idx] = direct * (1 - weight) + component * weight
    return output


def v2_predictions(frame: pd.DataFrame, manifest: dict, models: dict) -> tuple[np.ndarray, list[dict[str, float]]]:
    output = np.zeros(len(frame))
    components: list[dict[str, float] | None] = [None] * len(frame)
    indexed = frame.reset_index(drop=True)
    for position, indices in indexed.groupby("historical_position").groups.items():
        idx = list(indices)
        rows = indexed.loc[idx]
        arrays = {target: np.maximum(0, model.predict(rows[manifest["features"]])) for target, model in models[position].items()}
        output[idx] = arrays[DIRECT_TARGET]
        for local, original in enumerate(idx):
            components[original] = {target: float(values[local]) for target, values in arrays.items() if target != DIRECT_TARGET}
    return output, [value or {} for value in components]


def feature_candidates(position: str) -> dict[str, list[str]]:
    full = V3_FEATURE_COLUMNS_BY_POSITION[position]
    return {
        "full": full,
        "opportunity_focused": opportunity_feature_subset(full),
        "without_epa": [feature for feature in full if "epa" not in feature and "success_rate" not in feature],
        "without_game_script": [feature for feature in full if not any(token in feature for token in ("neutral", "trailing", "leading", "score_differential", "two_minute"))],
        "without_old_history": [feature for feature in full if not feature.startswith("prior_season_")],
    }


def fit_direct_experiment(train: pd.DataFrame, validation: pd.DataFrame, features_by_position: dict[str, list[str]], params: dict) -> tuple[np.ndarray, dict[str, float]]:
    predicted = np.zeros(len(validation))
    indexed = validation.reset_index(drop=True)
    for position, indices in indexed.groupby("historical_position").groups.items():
        idx = list(indices)
        features = features_by_position[position]
        training = train.loc[train["historical_position"].eq(position)]
        model = regressor(params)
        model.fit(training[features], training[DIRECT_TARGET])
        predicted[idx] = np.maximum(0, model.predict(indexed.loc[idx, features]))
    return predicted, with_bias(indexed[DIRECT_TARGET].to_numpy(), predicted)


def train_final_models(train: pd.DataFrame, artifact: Path, features_by_position: dict[str, list[str]], params: dict) -> tuple[dict, dict]:
    manifest_positions: dict[str, dict] = {}
    loaded: dict[str, dict[str, object]] = {}
    for position in FANTASY_POSITIONS:
        rows = train.loc[train["historical_position"].eq(position)]
        features = features_by_position[position]
        files: dict[str, str] = {}
        loaded[position] = {}
        for target in [DIRECT_TARGET, *STAT_TARGETS_BY_POSITION[position]]:
            model = regressor(params)
            usable = rows.loc[rows[target].notna()]
            model.fit(usable[features], usable[target])
            filename = f"{position.lower()}__{target}.ubj"
            model.save_model(artifact / filename)
            files[target] = filename
            loaded[position][target] = model
        manifest_positions[position] = {"features": features, "models": files}
    return manifest_positions, loaded


def components_to_arrays(rows: list[dict[str, float]]) -> dict[str, np.ndarray]:
    keys = set().union(*(row.keys() for row in rows))
    return {key: np.array([row.get(key, 0.0) for row in rows]) for key in keys}


def select_direct_weights(validation: pd.DataFrame, candidate, choices=(0.0, 0.1, 0.25, 0.5)) -> dict[str, float]:
    weights: dict[str, float] = {}
    for position, indices in validation.reset_index(drop=True).groupby("historical_position").groups.items():
        idx = list(indices)
        actual = validation.reset_index(drop=True).loc[idx, DIRECT_TARGET].to_numpy()
        component = component_ppr(components_to_arrays([candidate.components[i] for i in idx]), len(idx))
        direct = candidate.direct[idx]
        weights[position] = min(choices, key=lambda value: float(np.mean(np.abs(actual - (component * (1 - value) + direct * value)))))
    return weights


def blended_from_candidate(validation: pd.DataFrame, candidate, weights: dict[str, float]) -> np.ndarray:
    result = np.zeros(len(validation))
    indexed = validation.reset_index(drop=True)
    for position, indices in indexed.groupby("historical_position").groups.items():
        idx = list(indices)
        component = component_ppr(components_to_arrays([candidate.components[i] for i in idx]), len(idx))
        # Mirror sparse protection used by inference.
        sparse = np.array([sample_weight(indexed.loc[i], position) for i in idx])
        effective = weights[position] * (0.25 + 0.75 * sparse)
        result[idx] = component * (1 - effective) + candidate.direct[idx] * effective
    return result


def select_hybrid_components(actual_frame: pd.DataFrame, v2_rows: list[dict[str, float]], v31_rows: list[dict[str, float]]) -> dict[str, dict[str, str]]:
    selection: dict[str, dict[str, str]] = {}
    indexed = actual_frame.reset_index(drop=True)
    for position, indices in indexed.groupby("historical_position").groups.items():
        idx = list(indices)
        selection[position] = {}
        for target in STAT_TARGETS_BY_POSITION[position]:
            actual = indexed.loc[idx, target].to_numpy()
            v2 = np.array([v2_rows[i].get(target, 0.0) for i in idx])
            v31 = np.array([v31_rows[i].get(target, 0.0) for i in idx])
            selection[position][target] = "v3_1" if np.mean(np.abs(actual - v31)) < np.mean(np.abs(actual - v2)) else "v2"
    return selection


def hybrid_prediction(frame: pd.DataFrame, selection: dict, v2_rows: list[dict[str, float]], v31_rows: list[dict[str, float]]) -> np.ndarray:
    combined = []
    for index, row in frame.reset_index(drop=True).iterrows():
        position = row["historical_position"]
        combined.append({target: (v31_rows[index] if source == "v3_1" else v2_rows[index]).get(target, 0.0) for target, source in selection[position].items()})
    return component_ppr(components_to_arrays(combined), len(frame))


def slice_metrics(frame: pd.DataFrame, columns: list[str]) -> dict:
    indexed = add_error_slices(frame)
    slices = {
        "overall": pd.Series(True, index=indexed.index),
        "role_increase": indexed["role_increase"], "role_decrease": indexed["role_decrease"],
        "low_history": indexed["history_bucket"].isin(["zero_games", "1_3_games", "4_8_games"]),
        "rookie_young": indexed["experience_bucket"].isin(["rookie", "young"]),
        "established_elite": indexed["established_elite"], "extreme_td_prior": indexed["extreme_td_prior"],
        "starter_proxy": indexed["starter_proxy"], "backup_proxy": ~indexed["starter_proxy"],
    }
    result = {name: {model: with_bias(indexed.loc[mask, DIRECT_TARGET].to_numpy(), indexed.loc[mask, model].to_numpy()) for model in columns} for name, mask in slices.items()}
    result["by_position"] = {position: {model: with_bias(group[DIRECT_TARGET].to_numpy(), group[model].to_numpy()) for model in columns} for position, group in indexed.groupby("historical_position")}
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and evaluate local-only Model v3.1 using 2024 for all selection.")
    parser.add_argument("--features", type=Path, default=V3_FEATURE_DATASET_PATH)
    parser.add_argument("--artifact-dir", type=Path, default=V3_1_ARTIFACT_DIR)
    args = parser.parse_args()
    started = time.perf_counter()
    frame = pd.read_csv(args.features, dtype={"player_id": "string"})
    usable = frame.loc[frame["career_games_before"].ge(1)].copy()
    train = usable.loc[usable["season"].between(2018, 2023)].copy()
    validation = usable.loc[usable["season"].eq(2024)].reset_index(drop=True)
    sealed_test = usable.loc[usable["season"].eq(2025)].reset_index(drop=True)
    args.artifact_dir.mkdir(parents=True, exist_ok=True)

    v2_manifest, v2_models = load_bundle(ARTIFACT_ROOT / "v2")
    v3_manifest, v3_models = load_v3_bundle(ARTIFACT_ROOT / "v3")
    validation_v2, validation_v2_components = v2_predictions(validation, v2_manifest, v2_models)
    validation_v3 = original_v3_prediction(validation, v3_manifest, v3_models)

    # Direct-model ablations are selection diagnostics only and never inspect 2025.
    ablations: dict[str, dict] = {}
    for name in ("full", "opportunity_focused", "without_epa", "without_game_script", "without_old_history"):
        feature_map = {position: feature_candidates(position)[name] for position in FANTASY_POSITIONS}
        _, metrics = fit_direct_experiment(train, validation, feature_map, BASE_PARAMS)
        ablations[name] = metrics
    selected_feature_name = min(ablations, key=lambda name: ablations[name]["mae"])
    selected_features = {position: feature_candidates(position)[selected_feature_name] for position in FANTASY_POSITIONS}

    searches = []
    for params in PARAMETER_CANDIDATES:
        _, metrics = fit_direct_experiment(train, validation, selected_features, params)
        searches.append({"params": params, "metrics": metrics})
    selected_search = min(searches, key=lambda item: item["metrics"]["mae"])

    positions, v31_models = train_final_models(train, args.artifact_dir, selected_features, selected_search["params"])
    base_candidate = predict_coherent_candidate(validation, v31_models, selected_features)
    direct_weights = select_direct_weights(validation, base_candidate)
    validation_v31 = blended_from_candidate(validation, base_candidate, direct_weights)

    actual_validation = validation[DIRECT_TARGET].to_numpy()
    global_weight = select_ensemble_weight(actual_validation, validation_v2, validation_v31)
    position_weights = {
        position: select_ensemble_weight(
            actual_validation[list(indices)], validation_v2[list(indices)], validation_v31[list(indices)]
        )
        for position, indices in validation.groupby("historical_position").groups.items()
    }
    validation_global = validation_v2 * (1 - global_weight) + validation_v31 * global_weight
    validation_position = np.array([
        validation_v2[index] * (1 - position_weights[row.historical_position]) + validation_v31[index] * position_weights[row.historical_position]
        for index, row in validation.iterrows()
    ])
    hybrid_selection = select_hybrid_components(validation, validation_v2_components, base_candidate.components)
    validation_hybrid = hybrid_prediction(validation, hybrid_selection, validation_v2_components, base_candidate.components)

    validation_report = validation.copy()
    validation_report["v2"] = validation_v2
    validation_report["v3"] = validation_v3
    validation_report["v3_1"] = validation_v31
    validation_report["global_ensemble"] = validation_global
    validation_report["position_ensemble"] = validation_position
    validation_report["component_hybrid"] = validation_hybrid
    validation_report = add_error_slices(validation_report)
    error_analysis(validation_report, ["v2", "v3", "v3_1"]).to_csv(V3_1_ERROR_REPORT_PATH, index=False)

    candidates = {
        "v3_1": with_bias(actual_validation, validation_v31),
        "global_ensemble": with_bias(actual_validation, validation_global),
        "position_ensemble": with_bias(actual_validation, validation_position),
        "component_hybrid": with_bias(actual_validation, validation_hybrid),
    }
    frozen_name = min(candidates, key=lambda name: candidates[name]["mae"])
    residuals_by_position = {}
    for position, group in validation_report.groupby("historical_position"):
        residuals = group[DIRECT_TARGET] - group[frozen_name]
        residuals_by_position[position] = {
            "p20": round(float(residuals.quantile(0.2)), 4),
            "p80": round(float(residuals.quantile(0.8)), 4),
        }
    frozen_manifest = {
        "version": "v3_1", "status": "experimental", "feature_version": V3_1_FEATURE_VERSION,
        "created_at": datetime.now(UTC).isoformat(), "random_seed": 42,
        "training_range": [2018, 2023], "validation_range": [2024, 2024], "sealed_test_range": [2025, 2025],
        "selection_used_test_data": False, "selected_feature_experiment": selected_feature_name,
        "hyperparameters": selected_search["params"], "direct_weights": direct_weights,
        "global_ensemble_weight_v3_1": global_weight, "position_ensemble_weights_v3_1": position_weights,
        "hybrid_component_sources": hybrid_selection, "frozen_candidate": frozen_name,
        "residuals_by_position": residuals_by_position,
        "positions": positions, "validation": {
            "v2": with_bias(actual_validation, validation_v2), "v3": with_bias(actual_validation, validation_v3),
            **candidates, "slices": slice_metrics(validation_report, ["v2", "v3", "v3_1", "global_ensemble", "position_ensemble", "component_hybrid"]),
        },
        "ablations": ablations, "hyperparameter_search": searches,
    }
    # Selection is persisted before the sealed test is read by any decision logic.
    write_json(args.artifact_dir / "selection_manifest.json", frozen_manifest)

    # Final 2025 evaluation: no choices below this line may alter the frozen manifest.
    test_v2, test_v2_components = v2_predictions(sealed_test, v2_manifest, v2_models)
    test_v3 = original_v3_prediction(sealed_test, v3_manifest, v3_models)
    test_base = predict_coherent_candidate(sealed_test, v31_models, selected_features)
    test_v31 = blended_from_candidate(sealed_test, test_base, direct_weights)
    test_global = test_v2 * (1 - global_weight) + test_v31 * global_weight
    test_position = np.array([
        test_v2[index] * (1 - position_weights[row.historical_position]) + test_v31[index] * position_weights[row.historical_position]
        for index, row in sealed_test.iterrows()
    ])
    test_hybrid = hybrid_prediction(sealed_test, hybrid_selection, test_v2_components, test_base.components)
    test_report = sealed_test.copy()
    for name, values in {"v2": test_v2, "v3": test_v3, "v3_1": test_v31, "global_ensemble": test_global, "position_ensemble": test_position, "component_hybrid": test_hybrid}.items():
        test_report[name] = values
    actual_test = sealed_test[DIRECT_TARGET].to_numpy()
    frozen_values = test_report[frozen_name].to_numpy()
    frozen_manifest["test"] = {
        **{name: with_bias(actual_test, test_report[name].to_numpy()) for name in ["v2", "v3", "v3_1", "global_ensemble", "position_ensemble", "component_hybrid"]},
        "bootstrap_frozen_minus_v2": bootstrap_mae_difference(actual_test, test_v2, frozen_values),
        "slices": slice_metrics(test_report, ["v2", "v3", "v3_1", "global_ensemble", "position_ensemble", "component_hybrid"]),
    }
    frozen_manifest["runtime_seconds"] = round(time.perf_counter() - started, 3)
    write_json(args.artifact_dir / "manifest.json", frozen_manifest)
    validation_report[["player_id", "season", "week", "historical_position", DIRECT_TARGET, "v2", "v3", "v3_1", "global_ensemble", "position_ensemble", "component_hybrid"]].to_csv(args.artifact_dir / "validation_predictions.csv.gz", index=False, compression="gzip")
    test_report[["player_id", "season", "week", "historical_position", DIRECT_TARGET, "v2", "v3", "v3_1", "global_ensemble", "position_ensemble", "component_hybrid"]].to_csv(args.artifact_dir / "test_predictions.csv.gz", index=False, compression="gzip")
    base_candidate.audit.to_csv(args.artifact_dir / "validation_team_coherence.csv", index=False)
    test_base.audit.to_csv(args.artifact_dir / "test_team_coherence.csv", index=False)
    write_json(V3_1_EXPERIMENT_REPORT_PATH, frozen_manifest)
    print(json.dumps({"selected": frozen_name, "validation": frozen_manifest["validation"], "test": frozen_manifest["test"], "runtime_seconds": frozen_manifest["runtime_seconds"]}, indent=2))
    print("Model v3.1 remains local-only; no production or Supabase rows were written.")


if __name__ == "__main__":
    main()
