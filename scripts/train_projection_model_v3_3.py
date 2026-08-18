#!/usr/bin/env python3
from __future__ import annotations

import json
import time
from datetime import UTC, datetime

import numpy as np
import pandas as pd

from projection_pipeline.config import DIRECT_TARGET, FANTASY_POSITIONS
from projection_pipeline.scoring import score_projected_stats_exact
from projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR
from projection_pipeline.v3_1_model import (
    bootstrap_mae_difference,
    predict_coherent_candidate,
    write_json,
)
from projection_pipeline.v3_2_config import (
    ROLLING_FOLDS,
    V3_2_ARTIFACT_DIR,
    V3_2_FEATURE_DATASET_PATH,
)
from projection_pipeline.v3_2_model import role_confidence_with_snaps
from projection_pipeline.v3_3_config import (
    ESTABLISHED_STARTER_MAX_DROP,
    RISING_ROLE_V3_2_WEIGHT,
    SCORING_TOLERANCE,
    V3_3_ARTIFACT_DIR,
    V3_3_FEATURE_VERSION,
    V3_3_REPORT_PATH,
)
from projection_pipeline.v3_3_model import apply_role_corrections, rising_role_mask
from projection_pipeline.v3_3_reconciliation import reconcile_components_exact
from train_projection_model_v3_2 import coherence_violations, metrics, slice_report, train_components


def corrected_predictions(
    frame: pd.DataFrame,
    v3_1: np.ndarray,
    v3_2: np.ndarray,
    rising_weight: float = RISING_ROLE_V3_2_WEIGHT,
    starter_margin: float = ESTABLISHED_STARTER_MAX_DROP,
) -> np.ndarray:
    return apply_role_corrections(frame, v3_1, v3_2, rising_weight, starter_margin)[0]


def exact_component_predictions(
    components: list[dict[str, float]], targets: np.ndarray, positions: pd.Series,
) -> tuple[np.ndarray, list[dict[str, float]], list[dict[str, float | str]]]:
    predictions: list[float] = []
    reconciled: list[dict[str, float]] = []
    diagnostics: list[dict[str, float | str]] = []
    for stats, target, position in zip(components, targets, positions, strict=True):
        final_stats, score, detail = reconcile_components_exact(stats, float(target), str(position))
        predictions.append(score)
        reconciled.append(final_stats)
        diagnostics.append(detail)
    return np.asarray(predictions), reconciled, diagnostics


def main() -> None:
    started = time.perf_counter()
    frame = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    frame = frame.loc[frame["career_games_before"].ge(1)].copy()
    v31_manifest = json.loads((V3_1_ARTIFACT_DIR / "manifest.json").read_text())
    v32_manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    features = {position: details["features"] for position, details in v32_manifest["models"].items()}
    params = v31_manifest["hyperparameters"]
    direct_weights = v32_manifest["direct_weights"]
    saved_oof = pd.read_csv(V3_2_ARTIFACT_DIR / "rolling_validation_predictions.csv.gz", dtype={"player_id": "string"})
    saved_actual = saved_oof[DIRECT_TARGET].to_numpy()
    saved_rising = rising_role_mask(saved_oof).to_numpy()
    tuning_rows: list[dict[str, float | str]] = []
    for weight in (0.0, 0.25, 0.5, 0.75, 1.0):
        predicted = corrected_predictions(
            saved_oof, saved_oof["v3_1"].to_numpy(), saved_oof["v3_2"].to_numpy(),
            rising_weight=weight, starter_margin=1e9,
        )
        tuning_rows.append({
            "family": "rising_weight", "value": weight, **metrics(saved_actual, predicted),
            "role_increase_mae": metrics(saved_actual[saved_rising], predicted[saved_rising])["mae"],
        })
    for margin in (0.5, 0.75, 1.0, 1.25):
        predicted = corrected_predictions(
            saved_oof, saved_oof["v3_1"].to_numpy(), saved_oof["v3_2"].to_numpy(),
            rising_weight=1.0, starter_margin=margin,
        )
        tuning_rows.append({
            "family": "starter_margin", "value": margin, **metrics(saved_actual, predicted),
            "role_increase_mae": metrics(saved_actual[saved_rising], predicted[saved_rising])["mae"],
        })

    rows: list[pd.DataFrame] = []
    team_audits: list[dict] = []
    reconciliation_details: list[dict] = []
    deterministic_drift: list[float] = []
    for train_end, validation_year in ROLLING_FOLDS:
        train = frame.loc[frame["season"].between(2018, train_end)]
        validation = frame.loc[frame["season"].eq(validation_year)].reset_index(drop=True)
        models = train_components(train, features, params)
        candidate = predict_coherent_candidate(
            validation, models, features, direct_weights,
            role_confidence_fn=role_confidence_with_snaps,
        )
        saved = saved_oof.loc[saved_oof["season"].eq(validation_year)].reset_index(drop=True)
        keys = ["player_id", "season", "week", "historical_position"]
        aligned = validation[keys].merge(
            saved[keys + ["v3_1", "v3_2"]], on=keys, how="left", validate="one_to_one",
        )
        if aligned[["v3_1", "v3_2"]].isna().any().any():
            raise RuntimeError(f"Saved v3.2 fold rows do not align for {validation_year}")
        deterministic_drift.extend(np.abs(candidate.predictions - aligned["v3_2"].to_numpy()))
        base31 = aligned["v3_1"].to_numpy()
        base32 = aligned["v3_2"].to_numpy()
        rising = corrected_predictions(validation, base31, base32, rising_weight=RISING_ROLE_V3_2_WEIGHT, starter_margin=1e9)
        anchor = corrected_predictions(validation, base31, base32, rising_weight=1.0, starter_margin=ESTABLISHED_STARTER_MAX_DROP)
        combined = corrected_predictions(validation, base31, base32)
        exact, reconciled, diagnostics = exact_component_predictions(
            candidate.components, combined, validation["historical_position"],
        )
        fold = validation[[column for column in saved.columns if column in validation]].copy()
        fold["v3_1"] = base31
        fold["v3_2"] = base32
        fold["e2_rising_protection"] = rising
        fold["e3_starter_anchor"] = anchor
        fold["e4_combined"] = combined
        fold["e5_exact_reconciliation"] = exact
        fold["v3_3"] = exact
        fold["component_ppr"] = [
            score_projected_stats_exact(stats, {"rec": 1.0}, position)
            for stats, position in zip(reconciled, validation["historical_position"], strict=True)
        ]
        rows.append(fold)
        team_audits.append({"validation_year": validation_year, **coherence_violations(candidate.audit)})
        reconciliation_details.extend({"validation_year": validation_year, **item} for item in diagnostics)

    oof = pd.concat(rows, ignore_index=True)
    experiments = [
        "v3_1", "v3_2", "e2_rising_protection", "e3_starter_anchor",
        "e4_combined", "e5_exact_reconciliation", "v3_3",
    ]
    actual = oof[DIRECT_TARGET].to_numpy()
    overall = {name: metrics(actual, oof[name].to_numpy()) for name in experiments}
    folds = {
        str(year): {name: metrics(group[DIRECT_TARGET].to_numpy(), group[name].to_numpy()) for name in experiments}
        for year, group in oof.groupby("season")
    }
    positions = {
        position: {name: metrics(group[DIRECT_TARGET].to_numpy(), group[name].to_numpy()) for name in experiments}
        for position, group in oof.groupby("historical_position")
    }
    slices = slice_report(oof, experiments)
    bootstrap = bootstrap_mae_difference(actual, oof["v3_2"].to_numpy(), oof["v3_3"].to_numpy())
    component_failures = int((oof["v3_3"] - oof["component_ppr"]).abs().gt(SCORING_TOLERANCE).sum())
    budget_violations = {
        key: sum(int(item[key]) for item in team_audits)
        for key in ("target_budget", "rb_carry_budget", "pass_attempt_budget")
    }
    gates = {
        "overall_mae": overall["v3_3"]["mae"] <= 4.3362,
        "role_increase": slices["role_increase"]["v3_3"]["mae"] <= 4.6376,
        "role_decrease": slices["role_decrease"]["v3_3"]["mae"] <= 4.10,
        "component_coherence": component_failures == 0,
        "team_budgets": sum(budget_violations.values()) == 0,
    }
    report = {
        "version": "v3_3", "status": "experimental", "feature_version": V3_3_FEATURE_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "architecture": {
            "rising_role_v3_2_weight": RISING_ROLE_V3_2_WEIGHT,
            "established_starter_max_drop": ESTABLISHED_STARTER_MAX_DROP,
            "exact_component_scoring": True,
        },
        "bounded_parameter_experiments": tuning_rows,
        "rolling_folds": [{"train": [2018, end], "validate": year} for end, year in ROLLING_FOLDS],
        "overall": overall, "folds": folds, "positions": positions, "slices": slices,
        "bootstrap_v3_3_minus_v3_2": bootstrap,
        "team_budget_violations": budget_violations,
        "component_ppr_failures": component_failures,
        "reconciliation": {
            "rows": len(reconciliation_details),
            "mean_abs_initial_residual": float(np.mean([abs(float(x["requested_target"]) - float(x["pre_residual_score"])) for x in reconciliation_details])),
            "max_abs_final_residual": float(max(abs(float(x["final_residual"])) for x in reconciliation_details)),
            "modes": pd.Series([x["mode"] for x in reconciliation_details]).value_counts().to_dict(),
        },
        "v3_2_reproduction_max_abs_drift": float(max(deterministic_drift)),
        "mandatory_gates": gates,
        "promotion_preliminary": all(gates.values()),
        "runtime_seconds": round(time.perf_counter() - started, 3),
    }
    V3_3_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(V3_3_ARTIFACT_DIR / "manifest.json", report)
    write_json(V3_3_REPORT_PATH, report)
    oof.to_csv(V3_3_ARTIFACT_DIR / "rolling_validation_predictions.csv.gz", index=False, compression="gzip")
    print(json.dumps({
        "overall": overall, "folds": folds, "bootstrap": bootstrap,
        "component_ppr_failures": component_failures,
        "team_budget_violations": budget_violations,
        "mandatory_gates": gates, "runtime_seconds": report["runtime_seconds"],
    }, indent=2))
    print("No Supabase data or production artifacts were changed.")


if __name__ == "__main__":
    main()
