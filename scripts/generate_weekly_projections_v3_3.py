#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from generate_weekly_projections import resolve_schedule
from generate_weekly_projections_v3_1 import attach_current_context
from projection_pipeline.config import HISTORICAL_STATS_PATH
from projection_pipeline.features import read_historical_stats
from projection_pipeline.scoring import default_scores, score_projected_stats_exact
from projection_pipeline.v3_1_config import V3_1_PROJECTION_OUTPUT_PATH
from projection_pipeline.v3_1_model import load_position_models, predict_coherent_candidate
from projection_pipeline.v3_2_config import SNAP_WEEKLY_PATH, V3_2_ARTIFACT_DIR
from projection_pipeline.v3_2_features import read_snap_weekly, snap_features_for_inference
from projection_pipeline.v3_2_model import role_confidence_with_snaps
from projection_pipeline.v3_3_config import (
    SCORING_TOLERANCE, V3_3_ARTIFACT_DIR, V3_3_COMPARISON_PATH,
    V3_3_FEATURE_VERSION, V3_3_PROJECTION_OUTPUT_PATH, V3_3_REPORT_PATH,
)
from projection_pipeline.v3_3_model import apply_role_corrections, declining_role_mask, established_starter_mask, rising_role_mask
from projection_pipeline.v3_3_reconciliation import reconcile_components_exact
from projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_FEATURE_DATASET_PATH
from projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly
from train_projection_model_v3_2 import coherence_violations


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate local-only v3.3 corrected projections.")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--week", type=int, default=1)
    parser.add_argument("--schedule", type=Path)
    parser.add_argument("--output", type=Path, default=V3_3_PROJECTION_OUTPUT_PATH)
    args = parser.parse_args()

    historical = read_historical_stats(HISTORICAL_STATS_PATH)
    advanced = read_advanced_weekly(PBP_WEEKLY_PATH)
    schedule = resolve_schedule(args.schedule, False)
    base = build_v3_inference_dataset(historical, advanced, args.season, args.week, schedule)
    inference = attach_current_context(base).reset_index(drop=True)
    snap_history = pd.read_csv(V3_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    inference = snap_features_for_inference(
        inference, snap_history, read_snap_weekly(SNAP_WEEKLY_PATH), args.season, args.week,
    ).reset_index(drop=True)
    v32_manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    v33_manifest = json.loads((V3_3_ARTIFACT_DIR / "manifest.json").read_text())
    models = load_position_models(V3_2_ARTIFACT_DIR, {"positions": v32_manifest["models"]})
    features = {position: details["features"] for position, details in v32_manifest["models"].items()}
    candidate = predict_coherent_candidate(
        inference, models, features, v32_manifest["direct_weights"],
        role_confidence_fn=role_confidence_with_snaps,
    )
    v31 = pd.read_csv(V3_1_PROJECTION_OUTPUT_PATH, dtype={"gsis_id": "string"})
    v31_by_player = v31.set_index("gsis_id")
    v31_map = v31_by_player["model_projection_ppr"]
    baseline = inference["player_id"].map(v31_map).fillna(pd.Series(candidate.predictions)).to_numpy(float)
    corrected, correction_counts = apply_role_corrections(inference, baseline, candidate.predictions)

    rows: list[dict] = []
    for index, source in inference.iterrows():
        position = str(source.historical_position)
        stats, final_ppr, reconciliation = reconcile_components_exact(
            candidate.components[index], corrected[index], position,
        )
        scores = default_scores(stats, position)
        prior_projection = v31_by_player.loc[source.player_id] if source.player_id in v31_by_player.index else None
        residual_low = (
            float(prior_projection.floor_ppr) - float(prior_projection.model_projection_ppr)
            if prior_projection is not None else -4.0
        )
        residual_high = (
            float(prior_projection.ceiling_ppr) - float(prior_projection.model_projection_ppr)
            if prior_projection is not None else 4.0
        )
        confidence = str(prior_projection.confidence) if prior_projection is not None else "low"
        drivers = ["Model v3.3 opportunity-first projection", "Exact component reconciliation"]
        if bool(rising_role_mask(inference.iloc[[index]]).iloc[0]):
            drivers.append("Pregame rising-role protection")
        if bool(established_starter_mask(inference.iloc[[index]]).iloc[0]):
            drivers.append("Stable established-starter anchor")
        rows.append({
            "gsis_id": source.player_id, "player_name": source.get("player_name"),
            "season": args.season, "week": args.week, "season_type": "REG",
            "team": source.team if pd.notna(source.team) else None,
            "opponent_team": source.opponent_team if pd.notna(source.opponent_team) else None,
            "position": position, "depth_position": source.get("depth_position"),
            "depth_rank": source.get("depth_rank"), "is_starter": source.get("is_starter"),
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
            "pure_v3_2_projection_ppr": float(candidate.predictions[index]),
            "corrected_target_ppr": float(corrected[index]),
            "component_derived_ppr": float(final_ppr),
            "model_projection_ppr": float(final_ppr),
            "projected_points_standard": scores["standard"],
            "projected_points_half_ppr": scores["half_ppr"],
            "projected_points_ppr": scores["ppr"],
            "floor_ppr": max(0.0, float(final_ppr) + residual_low),
            "median_ppr": float(final_ppr),
            "ceiling_ppr": max(0.0, float(final_ppr) + residual_high),
            "residual_low": residual_low,
            "residual_high": residual_high,
            "confidence": confidence,
            "drivers": json.dumps(drivers),
            "reconciliation_mode": reconciliation["mode"],
            "reconciliation_residual": reconciliation["final_residual"],
            "model_version": "v3.3", "feature_version": V3_3_FEATURE_VERSION,
        })
    output = pd.DataFrame(rows).sort_values(["position", "model_projection_ppr"], ascending=[True, False])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False)

    comparison = output.merge(
        v31[["gsis_id", "model_projection_ppr"]].rename(columns={"model_projection_ppr": "v3_1"}),
        on="gsis_id", how="left", validate="one_to_one",
    )
    comparison["v3_2"] = comparison["pure_v3_2_projection_ppr"]
    comparison["v3_3"] = comparison["model_projection_ppr"]
    comparison["delta_vs_v3_2"] = comparison["v3_3"] - comparison["v3_2"]
    comparison.to_csv(V3_3_COMPARISON_PATH, index=False)

    serialized_component_scores = output.apply(
        lambda row: score_projected_stats_exact(
            json.loads(row["projected_stats"]), {"rec": 1.0}, str(row["position"]),
        ),
        axis=1,
    )
    component_failures = int((output["model_projection_ppr"] - serialized_component_scores).abs().gt(SCORING_TOLERANCE).sum())
    budgets = coherence_violations(candidate.audit)
    rb4 = int((comparison.position.eq("RB") & comparison.depth_rank.ge(4) & comparison.v3_3.gt(10)).sum())
    qb2 = int((comparison.position.eq("QB") & comparison.depth_rank.ge(2) & comparison.v3_3.gt(12)).sum())
    teamless = int((comparison.team.isna() & comparison.v3_3.gt(1)).sum())
    suppressions = comparison.loc[
        comparison.established_starter
        & ~comparison.role_decrease
        & comparison.v3_1.notna()
        & comparison.v3_3.lt(comparison.v3_1 - 1.5)
    ]
    current_gates = {
        "component_coherence": component_failures == 0,
        "team_budgets": sum(budgets.values()) == 0,
        "rb4": rb4 == 0, "qb2": qb2 == 0, "teamless": teamless == 0,
        "established_suppression": suppressions.empty,
    }
    prior_failure_diagnostics: dict[str, object] = {"rows": 0, "by_position": {}}
    prior_output_path = Path("data/processed/player_projections_v3_2.csv")
    if prior_output_path.exists():
        prior_output = pd.read_csv(prior_output_path)
        prior_output["component_score"] = prior_output.apply(
            lambda row: score_projected_stats_exact(
                json.loads(row["projected_stats"]), {"rec": 1.0}, str(row["position"]),
            ), axis=1,
        )
        prior_output["residual"] = prior_output["model_projection_ppr"] - prior_output["component_score"]
        failed = prior_output.loc[prior_output.residual.abs().gt(0.02)]
        prior_failure_diagnostics = {
            "reported_by_v3_2_audit": int(v32_manifest.get("current_sanity", {}).get("component_reconciliation_errors", len(failed))),
            "reproduced_from_serialized_v3_2_csv": int(len(failed)),
            "rows": int(len(failed)),
            "mean_abs_residual": float(failed.residual.abs().mean()) if len(failed) else 0.0,
            "median_abs_residual": float(failed.residual.abs().median()) if len(failed) else 0.0,
            "p95_abs_residual": float(failed.residual.abs().quantile(0.95)) if len(failed) else 0.0,
            "max_abs_residual": float(failed.residual.abs().max()) if len(failed) else 0.0,
            "positive_residuals": int(failed.residual.gt(0).sum()),
            "by_position": failed.groupby("position").residual.agg(
                rows="count", mean_abs=lambda value: value.abs().mean(),
                median_abs=lambda value: value.abs().median(),
                max_abs=lambda value: value.abs().max(),
            ).round(6).to_dict("index"),
        }
    v33_manifest["current_sanity"] = {
        "rows": len(output), "correction_counts": correction_counts,
        "component_ppr_failures": component_failures, "team_budget_violations": budgets,
        "rb4_over_10": rb4, "qb2_over_12": qb2, "teamless_over_1": teamless,
        "established_starter_suppressions": suppressions[
            ["player_name", "v3_1", "v3_2", "v3_3", "recent_snap_pct", "role_decrease"]
        ].to_dict("records"),
        "gates": current_gates,
    }
    v33_manifest["v3_2_reconciliation_failure_diagnostics"] = prior_failure_diagnostics
    v33_manifest["promotion_recommended"] = bool(v33_manifest["promotion_preliminary"] and all(current_gates.values()))
    V3_3_REPORT_PATH.write_text(json.dumps(v33_manifest, indent=2) + "\n")
    (V3_3_ARTIFACT_DIR / "manifest.json").write_text(json.dumps(v33_manifest, indent=2) + "\n")
    candidate.audit.to_csv(V3_3_ARTIFACT_DIR / "current_team_coherence.csv", index=False)
    print(f"Generated {len(output):,} local-only v3.3 projections.")
    print(f"Component/PPR failures: {component_failures}; team-budget violations: {sum(budgets.values())}.")
    print(f"Current safety: RB4={rb4}, QB2={qb2}, teamless={teamless}, unexplained starter suppressions={len(suppressions)}.")
    print(f"PROMOTION RECOMMENDED: {'YES' if v33_manifest['promotion_recommended'] else 'NO'}")
    print("No remote data was read or written and no production model was activated.")


if __name__ == "__main__":
    main()
