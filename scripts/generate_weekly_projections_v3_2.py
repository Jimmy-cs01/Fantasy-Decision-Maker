#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

if __package__:
    from .generate_weekly_projections import resolve_schedule
    from .generate_weekly_projections_v3_1 import attach_current_context
    from .projection_pipeline.config import DIRECT_TARGET, HISTORICAL_STATS_PATH
    from .projection_pipeline.features import read_historical_stats
    from .projection_pipeline.scoring import default_scores, reconcile_stat_line
    from .projection_pipeline.v3_1_config import V3_1_PROJECTION_OUTPUT_PATH
    from .projection_pipeline.v3_1_model import component_ppr, load_position_models, predict_coherent_candidate
    from .projection_pipeline.v3_2_config import SNAP_WEEKLY_PATH, V3_2_ARTIFACT_DIR, V3_2_COMPARISON_PATH, V3_2_PROJECTION_OUTPUT_PATH
    from .projection_pipeline.v3_2_features import read_snap_weekly, snap_features_for_inference
    from .projection_pipeline.v3_2_model import role_confidence_with_snaps
    from .projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_FEATURE_DATASET_PATH
    from .projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly
else:
    from generate_weekly_projections import resolve_schedule
    from generate_weekly_projections_v3_1 import attach_current_context
    from projection_pipeline.config import DIRECT_TARGET, HISTORICAL_STATS_PATH
    from projection_pipeline.features import read_historical_stats
    from projection_pipeline.scoring import default_scores, reconcile_stat_line
    from projection_pipeline.v3_1_config import V3_1_PROJECTION_OUTPUT_PATH
    from projection_pipeline.v3_1_model import component_ppr, load_position_models, predict_coherent_candidate
    from projection_pipeline.v3_2_config import SNAP_WEEKLY_PATH, V3_2_ARTIFACT_DIR, V3_2_COMPARISON_PATH, V3_2_PROJECTION_OUTPUT_PATH
    from projection_pipeline.v3_2_features import read_snap_weekly, snap_features_for_inference
    from projection_pipeline.v3_2_model import role_confidence_with_snaps
    from projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_FEATURE_DATASET_PATH
    from projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly


def selected_prediction(candidate, inference: pd.DataFrame, manifest: dict, v31: pd.DataFrame) -> np.ndarray:
    baseline_map = v31.set_index("gsis_id")["model_projection_ppr"]
    baseline_series = inference["player_id"].map(baseline_map)
    baseline = baseline_series.where(
        baseline_series.notna(), pd.Series(candidate.predictions, index=baseline_series.index)
    ).to_numpy(float)
    selected = manifest["selected_candidate"]
    if selected == "global_ensemble":
        weight = float(manifest["global_ensemble_weight_v3_2"])
        return baseline * (1 - weight) + candidate.predictions * weight
    if selected == "position_ensemble":
        weights = manifest["position_ensemble_weights_v3_2"]
        return np.array([
            baseline[index] * (1 - float(weights[row.historical_position]))
            + candidate.predictions[index] * float(weights[row.historical_position])
            for index, row in inference.iterrows()
        ])
    return candidate.predictions


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate local-only 2026 Model v3.2 comparison projections.")
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--schedule", type=Path)
    parser.add_argument("--artifact-dir", type=Path, default=V3_2_ARTIFACT_DIR)
    parser.add_argument("--output", type=Path, default=V3_2_PROJECTION_OUTPUT_PATH)
    args = parser.parse_args()

    historical = read_historical_stats(HISTORICAL_STATS_PATH)
    advanced = read_advanced_weekly(PBP_WEEKLY_PATH)
    schedule = resolve_schedule(args.schedule, False)
    base = build_v3_inference_dataset(historical, advanced, args.season, args.week, schedule)
    inference = attach_current_context(base).reset_index(drop=True)
    snap_history = pd.read_csv(V3_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    inference = snap_features_for_inference(inference, snap_history, read_snap_weekly(SNAP_WEEKLY_PATH), args.season, args.week).reset_index(drop=True)
    manifest = json.loads((args.artifact_dir / "manifest.json").read_text())
    models = load_position_models(args.artifact_dir, {"positions": manifest["models"]})
    features = {position: details["features"] for position, details in manifest["models"].items()}
    candidate = predict_coherent_candidate(
        inference, models, features, manifest["direct_weights"], role_confidence_fn=role_confidence_with_snaps,
    )
    v31 = pd.read_csv(V3_1_PROJECTION_OUTPUT_PATH, dtype={"gsis_id": "string"})
    frozen = selected_prediction(candidate, inference, manifest, v31)
    rows = []
    for index, source in inference.iterrows():
        position = source.historical_position
        final_ppr = max(0.0, float(frozen[index]))
        stats = {name: float(value) for name, value in candidate.components[index].items()}
        stats, _ = reconcile_stat_line(stats, final_ppr, position)
        scores = default_scores(stats, position)
        rows.append({
            "gsis_id": source.player_id, "player_name": source.get("player_name"),
            "season": args.season, "week": args.week, "season_type": "REG",
            "team": source.team if pd.notna(source.team) else None,
            "position": position, "depth_position": source.get("depth_position"),
            "depth_rank": source.get("depth_rank"), "is_starter": source.get("is_starter"),
            "recent_snap_pct": source.get("snap_pct_last_1"),
            "rolling_3_snap_pct": source.get("snap_pct_last_3"),
            "rolling_5_snap_pct": source.get("snap_pct_last_5"),
            "snap_trend": source.get("snap_pct_trend_3"),
            "snap_role_confidence": role_confidence_with_snaps(source, position),
            "expected_pass_attempts": stats.get("pass_attempts", 0.0),
            "expected_rush_attempts": stats.get("rush_attempts", 0.0),
            "expected_targets": stats.get("targets", 0.0),
            "projected_stats": json.dumps({key: round(float(value), 3) for key, value in stats.items()}, sort_keys=True),
            "pure_v3_2_projection_ppr": float(candidate.predictions[index]),
            "model_projection_ppr": final_ppr,
            "projected_points_standard": scores["standard"],
            "projected_points_half_ppr": scores["half_ppr"],
            "projected_points_ppr": scores["ppr"],
            "model_version": "v3_2", "feature_version": manifest["feature_version"],
            "frozen_candidate": manifest["selected_candidate"],
        })
    output = pd.DataFrame(rows).sort_values(["position", "model_projection_ppr"], ascending=[True, False])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False)
    candidate.audit.to_csv(args.artifact_dir / "current_team_coherence.csv", index=False)

    comparison = output.merge(
        v31[["gsis_id", "model_projection_ppr", "expected_pass_attempts", "expected_rush_attempts", "expected_targets"]].rename(columns={
            "model_projection_ppr": "v3_1", "expected_pass_attempts": "v3_1_pass_attempts",
            "expected_rush_attempts": "v3_1_rush_attempts", "expected_targets": "v3_1_targets",
        }), on="gsis_id", how="left", validate="one_to_one",
    )
    v2_path = Path("data/processed/player_projections_v2.csv")
    if not v2_path.exists():
        v2_path = Path("data/processed/player_projections.csv")
    if v2_path.exists():
        v2 = pd.read_csv(v2_path, dtype={"gsis_id": "string"})
        value_column = "model_projection_ppr" if "model_projection_ppr" in v2 else "projected_points_ppr"
        comparison = comparison.merge(v2[["gsis_id", value_column]].rename(columns={value_column: "v2"}), on="gsis_id", how="left")
    comparison["v3_2"] = comparison["model_projection_ppr"]
    comparison["difference_vs_v3_1"] = comparison["v3_2"] - comparison["v3_1"]
    comparison.to_csv(V3_2_COMPARISON_PATH, index=False)
    warnings = comparison.loc[
        (comparison.position.eq("RB") & comparison.depth_rank.ge(4) & comparison.v3_2.gt(10))
        | (comparison.position.eq("QB") & comparison.depth_rank.ge(2) & comparison.v3_2.gt(12))
        | (comparison.team.isna() & comparison.v3_2.gt(1))
    ]
    audit = candidate.audit
    budget_violations = {
        "target_budget": int((audit.targets_after > audit.target_budget + 1e-6).sum()),
        "rb_carry_budget": int((audit.rb_carries_after > audit.rb_carry_budget + 1e-6).sum()),
        "pass_attempt_budget": int((audit.pass_attempts_after > audit.pass_attempt_budget + 1e-6).sum()),
    }
    component_errors = 0
    for record in output.to_dict("records"):
        component_ppr = default_scores(json.loads(record["projected_stats"]), str(record["position"]))["ppr"]
        if abs(component_ppr - float(record["model_projection_ppr"])) > 0.02:
            component_errors += 1
    established_suppressions = comparison.loc[
        comparison.depth_rank.eq(1)
        & comparison.recent_snap_pct.ge(0.70)
        & comparison.v3_1.ge(10)
        & comparison.difference_vs_v3_1.le(-1.5)
    ]
    report_path = args.artifact_dir / "manifest.json"
    role_increase_preserved = (
        manifest["slices"]["role_increase"][manifest["selected_candidate"]]["mae"]
        <= manifest["slices"]["role_increase"]["v3_1"]["mae"]
    )
    final_gate = bool(
        manifest["promotion_preliminary"]
        and role_increase_preserved
        and not len(warnings)
        and not sum(budget_violations.values())
        and component_errors == 0
        and established_suppressions.empty
    )
    manifest["current_sanity"] = {
        "rows": int(len(output)), "rb4_over_10": int((comparison.position.eq("RB") & comparison.depth_rank.ge(4) & comparison.v3_2.gt(10)).sum()),
        "qb2_over_12": int((comparison.position.eq("QB") & comparison.depth_rank.ge(2) & comparison.v3_2.gt(12)).sum()),
        "teamless_over_1": int((comparison.team.isna() & comparison.v3_2.gt(1)).sum()),
        "team_budget_violations": budget_violations, "component_reconciliation_errors": component_errors,
        "role_increase_preserved": role_increase_preserved,
        "established_starter_suppressions": established_suppressions[["player_name", "v3_1", "v3_2", "difference_vs_v3_1"]].to_dict("records"),
    }
    manifest["promotion_recommended"] = final_gate
    manifest["promotion_blockers"] = [
        reason for failed, reason in [
            (not role_increase_preserved, "role-increase slice worsened"),
            (component_errors > 0, f"{component_errors} component/PPR reconciliation errors"),
            (not established_suppressions.empty, f"{len(established_suppressions)} established starter suppressions"),
            (len(warnings) > 0, f"{len(warnings)} RB4/QB2/teamless sanity warnings"),
            (sum(budget_violations.values()) > 0, "team opportunity budget violations"),
        ] if failed
    ]
    report_path.write_text(json.dumps(manifest, indent=2) + "\n")
    Path("data/processed/model_v3_2_report.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Generated {len(output):,} local-only v3.2 projections; sanity warnings: {len(warnings):,}.")
    print(f"Component reconciliation errors: {component_errors:,}; final promotion gate: {'YES' if final_gate else 'NO'}.")
    if manifest["promotion_blockers"]:
        print("Promotion blockers: " + "; ".join(manifest["promotion_blockers"]))
    print(f"Output: {args.output}")
    print(f"Comparison: {V3_2_COMPARISON_PATH}")
    print("No projection rows were imported or reconciled remotely.")


if __name__ == "__main__":
    main()
