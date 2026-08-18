from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from .config import DIRECT_TARGET, FANTASY_POSITIONS, STAT_TARGETS_BY_POSITION
from .model import load_bundle, load_model, new_regressor
from .v3_config import (
    MODEL_RANDOM_SEED, PBP_FEATURE_VERSION, V3_FEATURE_COLUMNS_BY_POSITION,
)


def metric_set(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | int | None]:
    mask = np.isfinite(actual) & np.isfinite(predicted)
    actual, predicted = actual[mask], predicted[mask]
    if not len(actual):
        return {"rows": 0, "mae": None, "rmse": None, "r2": None, "correlation": None}
    error = predicted - actual
    denominator = float(np.sum(np.square(actual - np.mean(actual))))
    r2 = 1 - float(np.sum(np.square(error))) / denominator if denominator > 0 else math.nan
    correlation = float(np.corrcoef(actual, predicted)[0, 1]) if len(actual) > 1 else math.nan
    return {
        "rows": int(len(actual)),
        "mae": round(float(np.mean(np.abs(error))), 4),
        "rmse": round(float(np.sqrt(np.mean(np.square(error)))), 4),
        "r2": round(r2, 4) if math.isfinite(r2) else None,
        "correlation": round(correlation, 4) if math.isfinite(correlation) else None,
    }


def _conditional_residuals(predicted: np.ndarray, residuals: np.ndarray) -> list[dict[str, float | int]]:
    bands: list[dict[str, float | int]] = []
    for lower, upper in [(0, 5), (5, 10), (10, 15), (15, 20), (20, 1000)]:
        selected = residuals[(predicted >= lower) & (predicted < upper)]
        if len(selected) < 40:
            selected = residuals
        bands.append({
            "minimum": lower, "maximum": upper,
            "p20": round(float(np.quantile(selected, 0.2)), 4),
            "p80": round(float(np.quantile(selected, 0.8)), 4),
            "rows": int(len(selected)),
        })
    return bands


def component_ppr(predictions: dict[str, np.ndarray], rows: int) -> np.ndarray:
    """Score independently modeled football components with ordinary PPR rates."""
    zeros = np.zeros(rows)
    value = lambda name: predictions.get(name, zeros)  # noqa: E731
    return (
        value("passing_yards") * 0.04
        + value("passing_touchdowns") * 4
        - value("interceptions_thrown") * 2
        + value("rushing_yards") * 0.1
        + value("rushing_touchdowns") * 6
        + value("receptions")
        + value("receiving_yards") * 0.1
        + value("receiving_touchdowns") * 6
    )


def _slice_flags(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    current = np.select(
        [
            output["historical_position"].eq("QB"),
            output["historical_position"].eq("RB"),
            output["historical_position"].isin(["WR", "TE"]),
        ],
        [output["pass_attempts"], output["true_touches"], output["targets"]],
        default=0,
    )
    prior = np.select(
        [
            output["historical_position"].eq("QB"),
            output["historical_position"].eq("RB"),
            output["historical_position"].isin(["WR", "TE"]),
        ],
        [output["pbp_pass_attempts_l3"], output["pbp_touches_l3"], output["pbp_targets_l3"]],
        default=np.nan,
    )
    threshold = np.select(
        [output["historical_position"].eq("QB"), output["historical_position"].eq("RB")],
        [18, 8],
        default=4,
    )
    output["_role_increase"] = np.isfinite(prior) & (prior >= threshold) & (current >= prior * 1.5)
    output["_role_decrease"] = np.isfinite(prior) & (prior >= threshold) & (current <= prior * 0.6)
    output["_role_change"] = output["_role_increase"] | output["_role_decrease"]
    rush_td_rate = output["rushing_touchdowns_season_avg"].div(output["rush_attempts_season_avg"].replace(0, np.nan))
    output["_extreme_td_rate"] = (
        output["passing_td_rate_season"].gt(0.08)
        | output["receiving_td_rate_season"].gt(0.15)
        | rush_td_rate.gt(0.12)
    )
    output["_established_elite"] = (
        output["prior_season_games"].ge(10)
        & output["prior_season_position_rank_pct"].ge(0.8)
    )
    return output


def chronological_split(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Return the immutable v3 evaluation split; never randomly shuffle player-weeks."""
    return (
        frame.loc[frame["season"].between(2018, 2023)],
        frame.loc[frame["season"].eq(2024)],
        frame.loc[frame["season"].eq(2025)],
    )


def _predict_bundle(
    models: dict[str, dict[str, object]],
    manifest: dict,
    frame: pd.DataFrame,
    per_position_features: bool,
) -> pd.DataFrame:
    pieces: list[pd.DataFrame] = []
    for position, rows in frame.groupby("historical_position", sort=False):
        if position not in models:
            continue
        features = (
            manifest["positions"][position]["features"]
            if per_position_features
            else manifest["features"]
        )
        predicted = models[position][DIRECT_TARGET].predict(rows[features])
        pieces.append(rows.assign(_prediction=np.maximum(0, predicted)))
    return pd.concat(pieces).sort_index() if pieces else frame.iloc[0:0].assign(_prediction=[])


def train_v3_bundle(
    frame: pd.DataFrame,
    artifact_dir: Path,
    version: str = "v3",
    v2_artifact_dir: Path | None = None,
) -> dict:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    usable = frame.loc[frame["career_games_before"].ge(1) & frame["season"].between(2018, 2025)].copy()
    train, validation, test = chronological_split(usable)
    if train.empty or validation.empty or test.empty:
        raise ValueError("Model v3 requires train 2018–2023, validation 2024, and test 2025 rows")

    manifest: dict = {
        "version": version,
        "status": "experimental",
        "algorithm": "xgboost",
        "feature_version": PBP_FEATURE_VERSION,
        "random_seed": MODEL_RANDOM_SEED,
        "created_at": datetime.now(UTC).isoformat(),
        "training_range": [2018, 2023],
        "validation_range": [2024, 2024],
        "test_range": [2025, 2025],
        "percentiles": {"floor": 0.2, "median": 0.5, "ceiling": 0.8},
        "hyperparameters": {
            "n_estimators": 240, "max_depth": 4, "learning_rate": 0.04,
            "min_child_weight": 8, "subsample": 0.85, "colsample_bytree": 0.85,
        },
        "positions": {},
    }
    evaluation_rows: list[pd.DataFrame] = []
    component_metrics: dict[str, dict[str, dict]] = {}
    for position in FANTASY_POSITIONS:
        features = V3_FEATURE_COLUMNS_BY_POSITION[position]
        position_train = train.loc[train["historical_position"].eq(position)]
        position_validation = validation.loc[validation["historical_position"].eq(position)]
        position_test = test.loc[test["historical_position"].eq(position)]
        models: dict[str, str] = {}
        position_component_metrics: dict[str, dict] = {}
        for target in [DIRECT_TARGET, *STAT_TARGETS_BY_POSITION[position]]:
            training_rows = position_train.loc[position_train[target].notna()]
            model = new_regressor()
            model.fit(training_rows[features], training_rows[target])
            filename = f"{position.lower()}__{target}.ubj"
            model.save_model(artifact_dir / filename)
            models[target] = filename
            predicted = np.maximum(0, model.predict(position_test[features]))
            position_component_metrics[target] = metric_set(position_test[target].to_numpy(), predicted)

        loaded = {target: load_model(artifact_dir / filename) for target, filename in models.items()}
        validation_predictions = {
            target: np.maximum(0, model.predict(position_validation[features]))
            for target, model in loaded.items()
        }
        test_predictions = {
            target: np.maximum(0, model.predict(position_test[features]))
            for target, model in loaded.items()
        }
        direct = loaded[DIRECT_TARGET]
        validation_direct = validation_predictions[DIRECT_TARGET]
        test_direct = test_predictions[DIRECT_TARGET]
        validation_component = component_ppr(validation_predictions, len(position_validation))
        test_component = component_ppr(test_predictions, len(position_test))
        actual_validation = position_validation[DIRECT_TARGET].to_numpy()
        candidate_weights = (0.0, 0.25, 0.5, 0.75, 1.0)
        component_weight = min(
            candidate_weights,
            key=lambda weight: float(np.mean(np.abs(
                actual_validation - (validation_direct * (1 - weight) + validation_component * weight)
            ))),
        )
        validation_prediction = np.maximum(
            0, validation_direct * (1 - component_weight) + validation_component * component_weight
        )
        test_prediction = np.maximum(
            0, test_direct * (1 - component_weight) + test_component * component_weight
        )
        residuals = actual_validation - validation_prediction
        importance = sorted(
            [
                {"feature": feature, "importance": round(float(value), 7)}
                for feature, value in zip(features, direct.feature_importances_, strict=True)
            ],
            key=lambda item: item["importance"],
            reverse=True,
        )
        manifest["positions"][position] = {
            "features": features,
            "models": models,
            "residual_p20": round(float(np.quantile(residuals, 0.2)), 4),
            "residual_p80": round(float(np.quantile(residuals, 0.8)), 4),
            "residual_bands": _conditional_residuals(validation_prediction, residuals),
            "validation_rows": int(len(position_validation)),
            "component_ppr_weight": component_weight,
            "validation_direct_ppr": metric_set(actual_validation, validation_direct),
            "validation_component_ppr": metric_set(actual_validation, validation_component),
            "validation_blended_ppr": metric_set(actual_validation, validation_prediction),
            "test_metrics": position_component_metrics[DIRECT_TARGET],
            "feature_importance": importance[:30],
        }
        component_metrics[position] = position_component_metrics
        evaluation_rows.append(position_test.assign(_v3=test_prediction))

    evaluated = _slice_flags(pd.concat(evaluation_rows).sort_index())
    v2_manifest: dict | None = None
    v2_models: dict[str, dict[str, object]] = {}
    if v2_artifact_dir and (v2_artifact_dir / "manifest.json").exists():
        v2_manifest, v2_models = load_bundle(v2_artifact_dir)
        v2 = _predict_bundle(v2_models, v2_manifest, evaluated, per_position_features=False)
        evaluated["_v2"] = v2["_prediction"]
    else:
        evaluated["_v2"] = np.nan

    def comparison(rows: pd.DataFrame) -> dict[str, dict]:
        return {
            "v2": metric_set(rows[DIRECT_TARGET].to_numpy(), rows["_v2"].to_numpy()),
            "v3": metric_set(rows[DIRECT_TARGET].to_numpy(), rows["_v3"].to_numpy()),
        }

    component_comparison: dict[str, dict[str, dict[str, dict]]] = {}
    for position in FANTASY_POSITIONS:
        rows = evaluated.loc[evaluated["historical_position"].eq(position)]
        v3_details = manifest["positions"][position]
        component_comparison[position] = {}
        for target in [DIRECT_TARGET, *STAT_TARGETS_BY_POSITION[position]]:
            v3_model = load_model(artifact_dir / v3_details["models"][target])
            v3_prediction = (
                rows["_v3"].to_numpy()
                if target == DIRECT_TARGET
                else np.maximum(0, v3_model.predict(rows[v3_details["features"]]))
            )
            v2_prediction = np.full(len(rows), np.nan)
            if v2_manifest is not None and target in v2_models[position]:
                v2_prediction = np.maximum(
                    0, v2_models[position][target].predict(rows[v2_manifest["features"]])
                )
            component_comparison[position][target] = {
                "v2": metric_set(rows[target].to_numpy(), v2_prediction),
                "v3": metric_set(rows[target].to_numpy(), v3_prediction),
            }

    manifest["evaluation"] = {
        "overall": comparison(evaluated),
        "by_position": {
            position: comparison(evaluated.loc[evaluated["historical_position"].eq(position)])
            for position in FANTASY_POSITIONS
        },
        "role_change": comparison(evaluated.loc[evaluated["_role_change"]]),
        "role_increase": comparison(evaluated.loc[evaluated["_role_increase"]]),
        "role_decrease": comparison(evaluated.loc[evaluated["_role_decrease"]]),
        "extreme_prior_td_rate": comparison(evaluated.loc[evaluated["_extreme_td_rate"]]),
        "established_elite": comparison(evaluated.loc[evaluated["_established_elite"]]),
        "components": component_comparison,
    }
    comparison_columns = [
        "player_id", "season", "week", "historical_position", DIRECT_TARGET,
        "_v2", "_v3", "_role_change", "_role_increase", "_role_decrease",
        "_extreme_td_rate", "_established_elite",
    ]
    evaluated[comparison_columns].to_csv(
        artifact_dir / "heldout_predictions.csv.gz", index=False, compression="gzip"
    )
    (artifact_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def load_v3_bundle(artifact_dir: Path) -> tuple[dict, dict[str, dict[str, object]]]:
    manifest = json.loads((artifact_dir / "manifest.json").read_text())
    models = {
        position: {
            target: load_model(artifact_dir / filename)
            for target, filename in details["models"].items()
        }
        for position, details in manifest["positions"].items()
    }
    return manifest, models


def predict_v3_targets(
    models: dict[str, object],
    frame: pd.DataFrame,
    features: list[str],
) -> dict[str, np.ndarray]:
    missing = sorted(set(features) - set(frame.columns))
    if missing:
        raise ValueError(f"v3 inference rows are missing features: {missing}")
    return {
        target: np.maximum(0, model.predict(frame[features]))
        for target, model in models.items()
    }
