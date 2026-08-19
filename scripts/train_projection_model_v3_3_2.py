#!/usr/bin/env python3
from __future__ import annotations

import json
import time
from datetime import UTC, datetime

import numpy as np
import pandas as pd

from projection_pipeline.config import DIRECT_TARGET
from projection_pipeline.evaluation_scoreboard import role_change_masks
from projection_pipeline.scoring import score_projected_stats_exact
from projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR
from projection_pipeline.v3_1_model import bootstrap_mae_difference, predict_coherent_candidate, write_json
from projection_pipeline.v3_2_config import ROLLING_FOLDS, V3_2_ARTIFACT_DIR, V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v3_2_model import role_confidence_with_snaps
from projection_pipeline.v3_3_1_model import apply_protective_role_corrections
from projection_pipeline.v3_3_2_config import (
    DIRECT_SAFETY_WEIGHT,
    TAIL_SAFETY_WEIGHT,
    V3_3_2_ARTIFACT_DIR,
    V3_3_2_FEATURE_VERSION,
    V3_3_2_REPORT_PATH,
)
from projection_pipeline.v3_3_2_model import (
    PassingHierarchyConfig,
    direct_safety_eligible_mask,
    passing_allocator,
    passing_coherence_metrics,
)
from train_projection_model_v3_2 import coherence_violations, metrics, slice_report, train_components
from train_projection_model_v3_3 import exact_component_predictions


EXPERIMENTS = {
    "e1_v3_3_1": None,
    "e2_hierarchy_no_refill": PassingHierarchyConfig(qb_budget_refill=0.0),
    "e3_hierarchy_half_refill": PassingHierarchyConfig(qb_budget_refill=0.5),
    "e4_hierarchy_full_refill": PassingHierarchyConfig(qb_budget_refill=1.0),
}
SAFETY_CANDIDATE = "e5_cap_only_direct_safety"
FINAL_CANDIDATE = "e6_tail_safety_rising_role"


def exact_candidate(frame: pd.DataFrame, candidate, v31: np.ndarray) -> np.ndarray:
    target, _ = apply_protective_role_corrections(frame, v31, candidate.predictions)
    return exact_component_predictions(candidate.components, target, frame["historical_position"])[0]


def main() -> None:
    started = time.perf_counter()
    frame = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    frame = frame.loc[frame.career_games_before.ge(1)].copy()
    v31_manifest = json.loads((V3_1_ARTIFACT_DIR / "manifest.json").read_text())
    v32_manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    features = {position: detail["features"] for position, detail in v32_manifest["models"].items()}
    params = v31_manifest["hyperparameters"]
    direct_weights = v32_manifest["direct_weights"]
    saved_v331 = pd.read_csv(
        V3_2_ARTIFACT_DIR.parent / "v3_3_1" / "rolling_validation_predictions.csv.gz",
        dtype={"player_id": "string"},
    )
    saved_v33 = pd.read_csv(
        V3_2_ARTIFACT_DIR.parent / "v3_3" / "rolling_validation_predictions.csv.gz",
        dtype={"player_id": "string"},
    )

    folds: list[pd.DataFrame] = []
    coherence: dict[str, list[dict[str, float | int]]] = {name: [] for name in EXPERIMENTS if name != "e1_v3_3_1"}
    budget_audits: dict[str, list[dict[str, int]]] = {name: [] for name in EXPERIMENTS if name != "e1_v3_3_1"}
    for train_end, validation_year in ROLLING_FOLDS:
        train = frame.loc[frame.season.between(2018, train_end)]
        validation = frame.loc[frame.season.eq(validation_year)].reset_index(drop=True)
        models = train_components(train, features, params)
        keys = ["player_id", "season", "week", "historical_position"]
        matching = saved_v33.loc[saved_v33.season.eq(validation_year)]
        matching_v331 = saved_v331.loc[saved_v331.season.eq(validation_year), keys + ["v3_3_1"]]
        matching = matching.merge(matching_v331, on=keys, how="left", validate="one_to_one")
        aligned = validation[keys].merge(
            matching[keys + ["v3_1", "v3_3", "v3_3_1"]],
            on=keys, how="left", validate="one_to_one",
        )
        if aligned[["v3_1", "v3_3_1"]].isna().any().any():
            raise RuntimeError(f"Saved baseline rows do not align for {validation_year}")
        fold = validation.copy()
        fold["v3_1"] = aligned.v3_1.to_numpy(float)
        fold["v3_3"] = aligned.v3_3.to_numpy(float)
        fold["e1_v3_3_1"] = aligned.v3_3_1.to_numpy(float)
        generated_candidates = {}

        for name, config in EXPERIMENTS.items():
            if config is None:
                continue
            candidate = predict_coherent_candidate(
                validation,
                models,
                features,
                direct_weights,
                role_confidence_fn=role_confidence_with_snaps,
                refill_budget=True,
                refill_week_one_only=True,
                current_qb_depth_gate=True,
                robust_week_one_context=True,
                passing_hierarchy_fn=passing_allocator(config),
            )
            generated_candidates[name] = candidate
            fold[name] = exact_candidate(validation, candidate, fold.v3_1.to_numpy(float))
            fold[f"{name}_direct"] = candidate.direct
            fold[f"{name}_component"] = np.array([
                score_projected_stats_exact(values, {"rec": 1.0}, str(position))
                for values, position in zip(candidate.components, validation.historical_position, strict=True)
            ])
            coherence[name].append(passing_coherence_metrics(candidate.audit))
            budget_audits[name].append(coherence_violations(candidate.audit))
            if name == "e2_hierarchy_no_refill":
                safety_target = (
                    (1.0 - DIRECT_SAFETY_WEIGHT) * fold[name].to_numpy(float)
                    + DIRECT_SAFETY_WEIGHT * candidate.direct
                )
                fold[SAFETY_CANDIDATE] = exact_component_predictions(
                    candidate.components,
                    safety_target,
                    validation["historical_position"],
                )[0]
                fold[f"{SAFETY_CANDIDATE}_direct"] = candidate.direct
                fold[f"{SAFETY_CANDIDATE}_component"] = fold[f"{name}_component"]
        base = generated_candidates["e2_hierarchy_no_refill"]
        rising = role_change_masks(validation)[0].to_numpy()
        final_target = (
            (1.0 - TAIL_SAFETY_WEIGHT) * fold["e2_hierarchy_no_refill"].to_numpy(float)
            + TAIL_SAFETY_WEIGHT * base.direct
        )
        final_target[rising] = fold.loc[rising, "e4_hierarchy_full_refill"].to_numpy(float)
        ineligible = ~direct_safety_eligible_mask(validation)
        final_target[ineligible] = fold.loc[ineligible, "e2_hierarchy_no_refill"].to_numpy(float)
        # Preserve one coherent team allocation. The rising-role correction is
        # a scoring target, not permission to splice rows from another team
        # allocation (which would break team-level sums).
        final_components = [dict(values) for values in base.components]
        fold[FINAL_CANDIDATE] = exact_component_predictions(
            final_components,
            final_target,
            validation["historical_position"],
        )[0]
        fold[f"{FINAL_CANDIDATE}_direct"] = base.direct
        fold[f"{FINAL_CANDIDATE}_component"] = np.array([
            score_projected_stats_exact(values, {"rec": 1.0}, str(position))
            for values, position in zip(final_components, validation.historical_position, strict=True)
        ])
        folds.append(fold)

    oof = pd.concat(folds, ignore_index=True)
    names = [*EXPERIMENTS, SAFETY_CANDIDATE, FINAL_CANDIDATE]
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
    coherence[SAFETY_CANDIDATE] = coherence["e2_hierarchy_no_refill"]
    coherence[FINAL_CANDIDATE] = coherence["e2_hierarchy_no_refill"]
    # E2 has the lowest mean error but materially worse RMSE/tail behavior.
    # E5 is the frozen safety candidate: the direct-model anchor is selected
    # on rolling folds to retain the hierarchy gain without accepting that risk.
    selected = FINAL_CANDIDATE
    bootstrap = bootstrap_mae_difference(actual, oof.e1_v3_3_1.to_numpy(float), oof[selected].to_numpy(float))
    selected_coherence = {
        key: sum(float(item[key]) for item in coherence[selected])
        for key in coherence[selected][0]
        if key != "teams"
    }
    selected_coherence["teams"] = int(sum(int(item["teams"]) for item in coherence[selected]))
    budget_violations = {
        name: {
            key: sum(item[key] for item in entries)
            for key in ("target_budget", "rb_carry_budget", "pass_attempt_budget")
        }
        for name, entries in budget_audits.items()
    }
    budget_violations[SAFETY_CANDIDATE] = budget_violations["e2_hierarchy_no_refill"]
    budget_violations[FINAL_CANDIDATE] = budget_violations["e2_hierarchy_no_refill"]
    report = {
        "version": "v3.3.2",
        "status": "experimental",
        "feature_version": V3_3_2_FEATURE_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "rolling_folds": [{"train": [2018, end], "validate": year} for end, year in ROLLING_FOLDS],
        "historical_constants": {
            "source_seasons": [2018, 2021],
            "targets_per_pass_attempt": PassingHierarchyConfig().targets_per_attempt,
            "modeled_target_coverage": PassingHierarchyConfig().modeled_target_coverage,
            "direct_safety_weight": DIRECT_SAFETY_WEIGHT,
            "tail_safety_weight": TAIL_SAFETY_WEIGHT,
        },
        "overall": overall,
        "folds": fold_metrics,
        "positions": positions,
        "slices": slices,
        "selected_candidate": selected,
        "bootstrap_selected_minus_v3_3_1": bootstrap,
        "passing_coherence": selected_coherence,
        "team_budget_violations": budget_violations,
        "runtime_seconds": round(time.perf_counter() - started, 3),
        "production_unchanged": True,
    }
    V3_3_2_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(V3_3_2_ARTIFACT_DIR / "manifest.json", report)
    write_json(V3_3_2_REPORT_PATH, report)
    oof.to_csv(V3_3_2_ARTIFACT_DIR / "rolling_validation_predictions.csv.gz", index=False, compression="gzip")
    print(json.dumps(report, indent=2))
    print("No Supabase rows or production settings were changed.")


if __name__ == "__main__":
    main()
