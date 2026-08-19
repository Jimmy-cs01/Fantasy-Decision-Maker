#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from generate_weekly_projections import resolve_schedule
from generate_weekly_projections_v3_1 import attach_current_context
from projection_pipeline.config import HISTORICAL_STATS_PATH
from projection_pipeline.evaluation_scoreboard import assign_empirical_confidence, role_change_masks
from projection_pipeline.features import read_historical_stats
from projection_pipeline.sanity_scoreboard import current_projection_sanity
from projection_pipeline.scoring import default_scores
from projection_pipeline.v3_1_config import V3_1_PROJECTION_OUTPUT_PATH
from projection_pipeline.v3_1_model import load_position_models, predict_coherent_candidate
from projection_pipeline.v3_2_config import SNAP_WEEKLY_PATH, V3_2_ARTIFACT_DIR
from projection_pipeline.v3_2_features import read_snap_weekly, snap_features_for_inference
from projection_pipeline.v3_2_model import role_confidence_with_snaps
from projection_pipeline.v3_3_1_config import (
    V3_3_1_ARTIFACT_DIR,
    V3_3_1_COMPARISON_PATH,
    V3_3_1_FEATURE_VERSION,
    V3_3_1_PROJECTION_OUTPUT_PATH,
    V3_3_1_REPORT_PATH,
    V3_3_1_VERSION,
)
from projection_pipeline.v3_3_1_model import apply_current_team_context, apply_protective_role_corrections
from projection_pipeline.v3_3_2_config import (
    TAIL_SAFETY_WEIGHT,
    V3_3_2_ARTIFACT_DIR,
    V3_3_2_COMPARISON_PATH,
    V3_3_2_FEATURE_VERSION,
    V3_3_2_FORENSICS_PATH,
    V3_3_2_PROJECTION_OUTPUT_PATH,
    V3_3_2_REPORT_PATH,
    V3_3_2_VERSION,
)
from projection_pipeline.v3_3_2_model import (
    PassingHierarchyConfig,
    direct_safety_eligible_mask,
    passing_allocator,
    passing_coherence_metrics,
)
from projection_pipeline.v3_3_model import declining_role_mask, established_starter_mask, rising_role_mask
from projection_pipeline.v3_3_reconciliation import reconcile_components_exact
from projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_FEATURE_DATASET_PATH
from projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly
from train_projection_model_v3_2 import coherence_violations


DEPTH_PATH = Path("data/processed/depth_chart_roles.csv")


def current_roles() -> pd.DataFrame:
    if not DEPTH_PATH.exists():
        return pd.DataFrame(columns=["player_id", "team"])
    depth = pd.read_csv(DEPTH_PATH, dtype={"gsis_id": "string"})
    return (
        depth.sort_values(["season", "source_updated_at", "fetched_at"])
        .groupby("gsis_id", as_index=False)
        .tail(1)
        .rename(columns={"gsis_id": "player_id"})
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate local-only v3.3.1 current-team allocation projections.")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--week", type=int, default=1)
    parser.add_argument("--schedule", type=Path)
    parser.add_argument("--model-version", choices=(V3_3_1_VERSION, V3_3_2_VERSION), default=V3_3_1_VERSION)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    is_v332 = args.model_version == V3_3_2_VERSION
    output_path = args.output or (V3_3_2_PROJECTION_OUTPUT_PATH if is_v332 else V3_3_1_PROJECTION_OUTPUT_PATH)

    historical = read_historical_stats(HISTORICAL_STATS_PATH)
    advanced = read_advanced_weekly(PBP_WEEKLY_PATH)
    schedule = resolve_schedule(args.schedule, False)
    base = build_v3_inference_dataset(historical, advanced, args.season, args.week, schedule)
    roles = current_roles()
    base = apply_current_team_context(base, roles, schedule, args.season, args.week)
    inference = attach_current_context(base).reset_index(drop=True)
    snap_history = pd.read_csv(V3_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    inference = snap_features_for_inference(
        inference, snap_history, read_snap_weekly(SNAP_WEEKLY_PATH), args.season, args.week,
    ).reset_index(drop=True)

    manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    models = load_position_models(V3_2_ARTIFACT_DIR, {"positions": manifest["models"]})
    features = {position: detail["features"] for position, detail in manifest["models"].items()}
    candidate = predict_coherent_candidate(
        inference,
        models,
        features,
        manifest["direct_weights"],
        role_confidence_fn=role_confidence_with_snaps,
        refill_budget=True,
        refill_week_one_only=True,
        current_qb_depth_gate=True,
        robust_week_one_context=True,
        passing_hierarchy_fn=passing_allocator(PassingHierarchyConfig(qb_budget_refill=0.0)) if is_v332 else None,
    )
    rising_candidate = None
    if is_v332:
        rising_candidate = predict_coherent_candidate(
            inference,
            models,
            features,
            manifest["direct_weights"],
            role_confidence_fn=role_confidence_with_snaps,
            refill_budget=True,
            refill_week_one_only=True,
            current_qb_depth_gate=True,
            robust_week_one_context=True,
            passing_hierarchy_fn=passing_allocator(PassingHierarchyConfig(qb_budget_refill=1.0)),
        )
    v31 = pd.read_csv(V3_1_PROJECTION_OUTPUT_PATH, dtype={"gsis_id": "string"})
    v31_by_player = v31.drop_duplicates("gsis_id").set_index("gsis_id")
    baseline = inference.player_id.map(v31_by_player.model_projection_ppr).fillna(
        pd.Series(candidate.predictions, index=inference.index),
    ).to_numpy(float)
    corrected, correction_counts = apply_protective_role_corrections(inference, baseline, candidate.predictions)
    component_rows = [dict(values) for values in candidate.components]
    if rising_candidate is not None:
        rising_corrected, _ = apply_protective_role_corrections(
            inference, baseline, rising_candidate.predictions,
        )
        corrected = (1.0 - TAIL_SAFETY_WEIGHT) * corrected + TAIL_SAFETY_WEIGHT * candidate.direct
        rising = role_change_masks(inference)[0].to_numpy()
        corrected[rising] = rising_corrected[rising]
        ineligible = ~direct_safety_eligible_mask(inference)
        corrected[ineligible] = apply_protective_role_corrections(
            inference, baseline, candidate.predictions,
        )[0][ineligible]

    rows: list[dict[str, object]] = []
    for index, source in inference.iterrows():
        position = str(source.historical_position)
        stats, final_ppr, reconciliation = reconcile_components_exact(
            component_rows[index], corrected[index], position,
        )
        scores = default_scores(stats, position)
        prior = v31_by_player.loc[source.player_id] if source.player_id in v31_by_player.index else None
        residual_low = float(prior.floor_ppr - prior.model_projection_ppr) if prior is not None else -4.0
        residual_high = float(prior.ceiling_ppr - prior.model_projection_ppr) if prior is not None else 4.0
        drivers = [
            "Opportunity-first component projection",
            "Exact component/PPR reconciliation",
        ]
        if is_v332:
            drivers.extend([
                "Empirical team passing hierarchy",
                "Bounded direct-model tail safety",
            ])
        rows.append({
            "gsis_id": source.player_id,
            "player_name": source.get("player_name"),
            "season": args.season,
            "week": args.week,
            "season_type": "REG",
            "team": source.team if pd.notna(source.team) else None,
            "opponent_team": source.opponent_team if pd.notna(source.opponent_team) else None,
            "position": position,
            "depth_position": source.get("depth_position"),
            "depth_rank": source.get("depth_rank"),
            "is_starter": source.get("is_starter"),
            "recent_snap_pct": source.get("snap_pct_last_1"),
            "rolling_3_snap_pct": source.get("snap_pct_last_3"),
            "recent_opportunities": source.get("pbp_pass_attempts_l3") if position == "QB" else (
                source.get("pbp_touches_l3") if position == "RB" else source.get("pbp_targets_l3")
            ),
            "role_increase": bool(rising_role_mask(inference.iloc[[index]]).iloc[0]),
            "role_decrease": bool(declining_role_mask(inference.iloc[[index]]).iloc[0]),
            "established_starter": bool(established_starter_mask(inference.iloc[[index]]).iloc[0]),
            "expected_pass_attempts": stats.get("pass_attempts", 0.0),
            "expected_rush_attempts": stats.get("rush_attempts", 0.0),
            "expected_targets": stats.get("targets", 0.0),
            "projected_stats": json.dumps({key: float(value) for key, value in stats.items()}, sort_keys=True),
            "raw_model_projection_ppr": float(candidate.direct[index]),
            "opportunity_projection_ppr": float(candidate.predictions[index]),
            "corrected_target_ppr": float(corrected[index]),
            "component_derived_ppr": float(final_ppr),
            "model_projection_ppr": float(final_ppr),
            "projected_points_standard": scores["standard"],
            "projected_points_half_ppr": scores["half_ppr"],
            "projected_points_ppr": scores["ppr"],
            "floor_ppr": max(0, final_ppr + residual_low),
            "median_ppr": final_ppr,
            "ceiling_ppr": max(0, final_ppr + residual_high),
            "residual_low": residual_low,
            "residual_high": residual_high,
            "confidence": str(prior.confidence) if prior is not None else "low",
            "drivers": json.dumps(drivers),
            "reconciliation_mode": reconciliation["mode"],
            "reconciliation_residual": reconciliation["final_residual"],
            "model_version": V3_3_2_VERSION if is_v332 else V3_3_1_VERSION,
            "feature_version": V3_3_2_FEATURE_VERSION if is_v332 else V3_3_1_FEATURE_VERSION,
        })

    output = pd.DataFrame(rows)
    if is_v332:
        confidence_prediction = "_confidence_prediction"
        calibration = pd.read_csv(
            V3_3_2_ARTIFACT_DIR / "rolling_validation_predictions.csv.gz",
            dtype={"player_id": "string"},
        )
        calibration[confidence_prediction] = calibration["e6_tail_safety_rising_role"]
        current_confidence = inference.copy()
        current_confidence[confidence_prediction] = output["model_projection_ppr"].to_numpy(float)
        confidence = assign_empirical_confidence(
            calibration, current_confidence, confidence_prediction,
        )
        output["confidence"] = confidence["empirical_confidence"].to_numpy()
        output["empirical_expected_error"] = confidence["expected_error"].to_numpy(float)
    output = output.sort_values(["position", "model_projection_ppr"], ascending=[True, False])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(output_path, index=False)
    comparison = output.merge(
        v31[["gsis_id", "model_projection_ppr"]].rename(columns={"model_projection_ppr": "v3_1"}),
        on="gsis_id", how="left", validate="one_to_one",
    )
    old = pd.read_csv("data/processed/model_v3_3_comparison.csv", dtype={"gsis_id": "string"})
    comparison = comparison.merge(old[["gsis_id", "v3_3"]], on="gsis_id", how="left", validate="one_to_one")
    model_column = "v3_3_2" if is_v332 else "v3_3_1"
    comparison[model_column] = comparison.model_projection_ppr
    comparison["delta_vs_v3_3"] = comparison[model_column] - comparison.v3_3
    comparison.to_csv(V3_3_2_COMPARISON_PATH if is_v332 else V3_3_1_COMPARISON_PATH, index=False)

    sanity = current_projection_sanity(output)
    budgets = coherence_violations(candidate.audit)
    artifact_dir = V3_3_2_ARTIFACT_DIR if is_v332 else V3_3_1_ARTIFACT_DIR
    report_path = V3_3_2_REPORT_PATH if is_v332 else V3_3_1_REPORT_PATH
    report = json.loads((artifact_dir / "manifest.json").read_text())
    report["current_generation"] = {
        "rows": int(len(output)),
        "corrections": correction_counts,
        "team_budget_violations": budgets,
        "sanity": sanity,
    }
    if is_v332:
        report["current_generation"]["passing_coherence"] = passing_coherence_metrics(candidate.audit)
        V3_3_2_FORENSICS_PATH.write_text(
            json.dumps(candidate.audit.to_dict(orient="records"), indent=2, default=str) + "\n",
        )
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    candidate.audit.to_csv(artifact_dir / "current_team_coherence.csv", index=False)
    print(f"Generated {len(output):,} local-only {args.model_version} projections.")
    print(f"Team-budget violations: {sum(budgets.values())}; severe sanity violations: {sanity['severe_violation_count']}.")
    print(f"Safe to promote: {'YES' if not sum(budgets.values()) and sanity['promotion_safe'] else 'NO'}")
    print("No remote data or production settings were changed.")


if __name__ == "__main__":
    main()
