#!/usr/bin/env python3
from __future__ import annotations

import json
import time
from datetime import UTC, datetime

import numpy as np
import pandas as pd

from projection_pipeline.config import DIRECT_TARGET
from projection_pipeline.scoring import score_projected_stats_exact
from projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR
from projection_pipeline.v3_1_model import bootstrap_mae_difference, predict_coherent_candidate, write_json
from projection_pipeline.v3_2_config import ROLLING_FOLDS, V3_2_ARTIFACT_DIR, V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v3_2_model import role_confidence_with_snaps
from projection_pipeline.v3_3_1_config import (
    V3_3_1_ARTIFACT_DIR,
    V3_3_1_FEATURE_VERSION,
    V3_3_1_REPORT_PATH,
)
from projection_pipeline.v3_3_1_model import apply_protective_role_corrections
from projection_pipeline.v3_3_reconciliation import reconcile_components_exact
from train_projection_model_v3_2 import coherence_violations, metrics, slice_report, train_components
from train_projection_model_v3_3 import exact_component_predictions


def exact_candidate(frame: pd.DataFrame, candidate, v31: np.ndarray) -> np.ndarray:
    target, _ = apply_protective_role_corrections(frame, v31, candidate.predictions)
    return exact_component_predictions(candidate.components, target, frame["historical_position"])[0]


def main() -> None:
    started = time.perf_counter()
    frame = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    frame = frame.loc[frame["career_games_before"].ge(1)].copy()
    v31_manifest = json.loads((V3_1_ARTIFACT_DIR / "manifest.json").read_text())
    v32_manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    features = {position: detail["features"] for position, detail in v32_manifest["models"].items()}
    params = v31_manifest["hyperparameters"]
    direct_weights = v32_manifest["direct_weights"]
    saved = pd.read_csv(V3_2_ARTIFACT_DIR.parent / "v3_3" / "rolling_validation_predictions.csv.gz", dtype={"player_id": "string"})

    folds: list[pd.DataFrame] = []
    audits: dict[str, list[dict[str, int]]] = {"refill_all": [], "refill_week1": [], "v3_3_1": []}
    for train_end, validation_year in ROLLING_FOLDS:
        train = frame.loc[frame["season"].between(2018, train_end)]
        validation = frame.loc[frame["season"].eq(validation_year)].reset_index(drop=True)
        models = train_components(train, features, params)
        matching = saved.loc[saved["season"].eq(validation_year)].reset_index(drop=True)
        keys = ["player_id", "season", "week", "historical_position"]
        aligned = validation[keys].merge(
            matching[keys + ["v3_1", "v3_3"]], on=keys, how="left", validate="one_to_one",
        )
        if aligned[["v3_1", "v3_3"]].isna().any().any():
            raise RuntimeError(f"Saved v3.3 rows do not align for {validation_year}")
        v31 = aligned["v3_1"].to_numpy(float)

        refill = predict_coherent_candidate(
            validation, models, features, direct_weights,
            role_confidence_fn=role_confidence_with_snaps,
            refill_budget=True,
        )
        robust = predict_coherent_candidate(
            validation, models, features, direct_weights,
            role_confidence_fn=role_confidence_with_snaps,
            refill_budget=True,
            refill_week_one_only=True,
            robust_week_one_context=True,
        )
        final = predict_coherent_candidate(
            validation, models, features, direct_weights,
            role_confidence_fn=role_confidence_with_snaps,
            refill_budget=True,
            refill_week_one_only=True,
            current_qb_depth_gate=True,
            robust_week_one_context=True,
        )
        fold = validation[[column for column in matching.columns if column in validation]].copy()
        fold["v3_3"] = aligned["v3_3"].to_numpy(float)
        fold["e1_refill"] = exact_candidate(validation, refill, v31)
        fold["e2_refill_robust_week1_only"] = exact_candidate(validation, robust, v31)
        fold["v3_3_1"] = exact_candidate(validation, final, v31)
        folds.append(fold)
        audits["refill_all"].append(coherence_violations(refill.audit))
        audits["refill_week1"].append(coherence_violations(robust.audit))
        audits["v3_3_1"].append(coherence_violations(final.audit))

    oof = pd.concat(folds, ignore_index=True)
    names = ["v3_3", "e1_refill", "e2_refill_robust_week1_only", "v3_3_1"]
    actual = oof[DIRECT_TARGET].to_numpy(float)
    overall = {name: metrics(actual, oof[name].to_numpy(float)) for name in names}
    fold_metrics = {
        str(year): {name: metrics(group[DIRECT_TARGET].to_numpy(), group[name].to_numpy()) for name in names}
        for year, group in oof.groupby("season")
    }
    positions = {
        position: {name: metrics(group[DIRECT_TARGET].to_numpy(), group[name].to_numpy()) for name in names}
        for position, group in oof.groupby("historical_position")
    }
    slices = slice_report(oof, names)
    bootstrap = bootstrap_mae_difference(actual, oof["v3_3"].to_numpy(), oof["v3_3_1"].to_numpy())
    budget_violations = {
        name: {
            key: sum(item[key] for item in entries)
            for key in ("target_budget", "rb_carry_budget", "pass_attempt_budget")
        }
        for name, entries in audits.items()
    }
    component_failures = int(sum(
        abs(float(row.v3_3_1) - score_projected_stats_exact(
            reconcile_components_exact({}, float(row.v3_3_1), str(row.historical_position))[0],
            {"rec": 1.0}, str(row.historical_position),
        )) > 1e-6
        for row in oof.itertuples()
    ))
    report = {
        "version": "v3.3.1",
        "status": "experimental",
        "feature_version": V3_3_1_FEATURE_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "architecture": {
            "role_weighted_budget_refill": "week_one_only",
            "robust_week_one_team_context": True,
            "current_qb_depth_gate": True,
            "protective_role_anchor_never_lowers_candidate": True,
        },
        "rolling_folds": [{"train": [2018, end], "validate": year} for end, year in ROLLING_FOLDS],
        "overall": overall,
        "folds": fold_metrics,
        "positions": positions,
        "slices": slices,
        "bootstrap_v3_3_1_minus_v3_3": bootstrap,
        "team_budget_violations": budget_violations,
        "component_ppr_failures": component_failures,
        "runtime_seconds": round(time.perf_counter() - started, 3),
    }
    V3_3_1_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(V3_3_1_ARTIFACT_DIR / "manifest.json", report)
    write_json(V3_3_1_REPORT_PATH, report)
    oof.to_csv(V3_3_1_ARTIFACT_DIR / "rolling_validation_predictions.csv.gz", index=False, compression="gzip")
    print(json.dumps(report, indent=2))
    print("No Supabase rows or production settings were changed.")


if __name__ == "__main__":
    main()
