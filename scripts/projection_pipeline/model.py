from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from .config import DIRECT_TARGET, FEATURE_COLUMNS, FANTASY_POSITIONS, STAT_TARGETS_BY_POSITION


def _xgboost():
    try:
        from xgboost import XGBRegressor
    except ImportError as error:
        raise RuntimeError("Install projection dependencies with: python3 -m pip install -r requirements-projections.txt") from error
    return XGBRegressor


def new_regressor():
    return _xgboost()(
        n_estimators=240,
        max_depth=4,
        learning_rate=0.04,
        min_child_weight=8,
        subsample=0.85,
        colsample_bytree=0.85,
        objective="reg:squarederror",
        eval_metric="mae",
        n_jobs=4,
        random_state=42,
    )


def metric_set(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | int | None]:
    mask = np.isfinite(actual) & np.isfinite(predicted)
    actual, predicted = actual[mask], predicted[mask]
    if not len(actual):
        return {"rows": 0, "mae": None, "rmse": None, "correlation": None}
    error = predicted - actual
    correlation = float(np.corrcoef(actual, predicted)[0, 1]) if len(actual) > 1 else math.nan
    return {
        "rows": int(len(actual)),
        "mae": round(float(np.mean(np.abs(error))), 4),
        "rmse": round(float(np.sqrt(np.mean(np.square(error)))), 4),
        "correlation": round(correlation, 4) if math.isfinite(correlation) else None,
    }


def _clean_training_rows(frame: pd.DataFrame) -> pd.DataFrame:
    return frame.loc[frame["career_games_before"].ge(1)].copy()


def _conditional_residuals(predicted: np.ndarray, residuals: np.ndarray) -> list[dict]:
    bands: list[dict] = []
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


def train_bundle(frame: pd.DataFrame, artifact_dir: Path, version: str) -> dict:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    usable = _clean_training_rows(frame)
    train = usable.loc[usable["season"].le(2022)]
    validation = usable.loc[usable["season"].eq(2023)]
    test = usable.loc[usable["season"].ge(2024)]
    if train.empty or validation.empty or test.empty:
        raise ValueError("Chronological train (<=2022), validation (2023), and test (>=2024) sets are required")

    manifest: dict = {
        "version": version,
        "algorithm": "xgboost",
        "features": FEATURE_COLUMNS,
        "training_range": [int(train.season.min()), int(train.season.max())],
        "validation_range": [2023, 2023],
        "test_range": [int(test.season.min()), int(test.season.max())],
        "percentiles": {"floor": 0.2, "median": 0.5, "ceiling": 0.8},
        "positions": {},
    }
    evaluation_rows = []
    for position in FANTASY_POSITIONS:
        position_train = train.loc[train["historical_position"].eq(position)]
        position_validation = validation.loc[validation["historical_position"].eq(position)]
        position_test = test.loc[test["historical_position"].eq(position)]
        position_models = {}
        targets = [DIRECT_TARGET, *STAT_TARGETS_BY_POSITION[position]]
        for target in targets:
            model = new_regressor()
            target_train = position_train.loc[position_train[target].notna()]
            model.fit(target_train[FEATURE_COLUMNS], target_train[target])
            filename = f"{position.lower()}__{target}.ubj"
            model.save_model(artifact_dir / filename)
            position_models[target] = filename

        direct = load_model(artifact_dir / position_models[DIRECT_TARGET])
        validation_prediction = np.maximum(0, direct.predict(position_validation[FEATURE_COLUMNS]))
        residuals = position_validation[DIRECT_TARGET].to_numpy() - validation_prediction
        test_prediction = np.maximum(0, direct.predict(position_test[FEATURE_COLUMNS]))
        position_metrics = metric_set(position_test[DIRECT_TARGET].to_numpy(), test_prediction)
        manifest["positions"][position] = {
            "models": position_models,
            "residual_p20": round(float(np.quantile(residuals, 0.2)), 4),
            "residual_p80": round(float(np.quantile(residuals, 0.8)), 4),
            "residual_bands": _conditional_residuals(validation_prediction, residuals),
            "validation_rows": int(len(position_validation)),
            "test_metrics": position_metrics,
        }
        evaluation_rows.append(position_test.assign(_model=test_prediction))

    evaluated = pd.concat(evaluation_rows, ignore_index=True)
    predictions = evaluated["_model"].to_numpy()
    actual = evaluated[DIRECT_TARGET].to_numpy()
    prior_weight = (
        0.2
        * (1 - evaluated["games_played_before"] / 8).clip(lower=0)
        * evaluated["prior_season_games"].fillna(0).ge(4)
    )
    evaluated["_historical_prior_blend"] = (
        evaluated["_model"] * (1 - prior_weight)
        + evaluated["prior_season_ppr_ppg"].fillna(evaluated["_model"]) * prior_weight
    )
    baselines = {
        "xgboost": metric_set(actual, predictions),
        "historical_prior_blend": metric_set(actual, evaluated["_historical_prior_blend"].to_numpy()),
        "season_ppg": metric_set(actual, evaluated["fantasy_points_ppr_season_avg"].to_numpy()),
        "last_3": metric_set(actual, evaluated["fantasy_points_ppr_l3"].to_numpy()),
        "last_5": metric_set(actual, evaluated["fantasy_points_ppr_l5"].to_numpy()),
    }
    manifest["evaluation"] = {
        "overall": baselines,
        "by_position": {position: manifest["positions"][position]["test_metrics"] for position in FANTASY_POSITIONS},
        "weeks_1_4": {
            name: metric_set(
                evaluated.loc[evaluated["week"].le(4), DIRECT_TARGET].to_numpy(),
                (evaluated.loc[evaluated["week"].le(4), {
                    "xgboost": "_model",
                    "historical_prior_blend": "_historical_prior_blend",
                     "season_ppg": "fantasy_points_ppr_season_avg",
                     "last_3": "fantasy_points_ppr_l3",
                     "last_5": "fantasy_points_ppr_l5",
                 }[name]].to_numpy()),
            )
            for name in baselines
        },
    }
    (artifact_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def load_model(path: Path):
    model = _xgboost()()
    model.load_model(path)
    return model


def load_bundle(artifact_dir: Path) -> tuple[dict, dict[str, dict[str, object]]]:
    manifest = json.loads((artifact_dir / "manifest.json").read_text())
    models = {
        position: {
            target: load_model(artifact_dir / filename)
            for target, filename in details["models"].items()
        }
        for position, details in manifest["positions"].items()
    }
    return manifest, models


def predict_targets(models: dict[str, object], frame: pd.DataFrame, feature_columns: list[str] | None = None) -> dict[str, np.ndarray]:
    """Run every position target model against the canonical feature order."""
    feature_columns = feature_columns or FEATURE_COLUMNS
    missing = sorted(set(feature_columns) - set(frame.columns))
    if missing:
        raise ValueError(f"Inference rows are missing model features: {missing}")
    return {
        target: np.maximum(0, model.predict(frame[feature_columns]))
        for target, model in models.items()
    }


def residual_interval(details: dict, projection: float) -> tuple[float, float]:
    for band in details.get("residual_bands", []):
        if float(band["minimum"]) <= projection < float(band["maximum"]):
            return float(band["p20"]), float(band["p80"])
    return float(details["residual_p20"]), float(details["residual_p80"])


def confidence_for(row: pd.Series, residual_width: float) -> str:
    games = float(row.get("career_games_before", row.get("games_played_before", 0)) or 0)
    recent = [row.get("fantasy_points_ppr_l3"), row.get("fantasy_points_ppr_l5")]
    stable = all(pd.notna(value) for value in recent) and abs(float(recent[0]) - float(recent[1])) <= 4
    if games >= 8 and stable and residual_width <= 16:
        return "high"
    if games >= 4:
        return "medium"
    return "low"


def projection_drivers(row: pd.Series) -> list[str]:
    drivers: list[str] = []
    recent, season = row.get("fantasy_points_ppr_l3"), row.get("fantasy_points_ppr_season_avg")
    if pd.notna(recent) and pd.notna(season):
        difference = float(recent) - float(season)
        if difference >= 3:
            drivers.append("Recent production is above the player's season average")
        elif difference <= -3:
            drivers.append("Recent production is below the player's season average")
    usage = row.get("targets_l3") if row.get("historical_position") in {"WR", "TE"} else row.get("true_touches_l3")
    if pd.notna(usage) and float(usage) >= (7 if row.get("historical_position") in {"WR", "TE"} else 15):
        drivers.append("Strong recent opportunity volume")
    matchup, matchup_season = row.get("opp_fantasy_points_allowed_l3"), row.get("opp_fantasy_points_allowed_season")
    if pd.notna(matchup) and pd.notna(matchup_season):
        drivers.append("Favorable recent opponent matchup" if float(matchup) > float(matchup_season) * 1.08 else "Opponent matchup is near its season baseline")
    if pd.isna(row.get("opponent_team")):
        drivers.append("Matchup data is unavailable until a schedule is supplied")
    if not drivers:
        drivers.append("Projection is driven by season and recent player usage")
    return drivers[:3]
