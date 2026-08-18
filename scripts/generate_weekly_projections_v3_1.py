#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

if __package__:
    from .generate_weekly_projections import resolve_schedule
    from .projection_pipeline.config import ARTIFACT_ROOT, DIRECT_TARGET, HISTORICAL_STATS_PATH
    from .projection_pipeline.features import read_historical_stats
    from .projection_pipeline.model import load_bundle
    from .projection_pipeline.scoring import default_scores, reconcile_stat_line
    from .projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR, V3_1_COHERENCE_REPORT_PATH, V3_1_PROJECTION_OUTPUT_PATH
    from .projection_pipeline.v3_1_model import (
        coherent_components, component_ppr, history_category, load_position_models,
        predict_coherent_candidate, role_confidence, sample_weight,
    )
    from .projection_pipeline.v3_config import PBP_WEEKLY_PATH
    from .projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly
else:
    from generate_weekly_projections import resolve_schedule
    from projection_pipeline.config import ARTIFACT_ROOT, DIRECT_TARGET, HISTORICAL_STATS_PATH
    from projection_pipeline.features import read_historical_stats
    from projection_pipeline.model import load_bundle
    from projection_pipeline.scoring import default_scores, reconcile_stat_line
    from projection_pipeline.v3_1_config import V3_1_ARTIFACT_DIR, V3_1_COHERENCE_REPORT_PATH, V3_1_PROJECTION_OUTPUT_PATH
    from projection_pipeline.v3_1_model import (
        coherent_components, component_ppr, history_category, load_position_models,
        predict_coherent_candidate, role_confidence, sample_weight,
    )
    from projection_pipeline.v3_config import PBP_WEEKLY_PATH
    from projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly


def attach_current_context(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    depth_path = Path("data/processed/depth_chart_roles.csv")
    if depth_path.exists():
        depth = pd.read_csv(depth_path, dtype={"gsis_id": "string"})
        latest = depth.sort_values(["season", "source_updated_at", "fetched_at"]).groupby("gsis_id", as_index=False).tail(1)
        output = output.merge(
            latest[["gsis_id", "depth_position", "depth_rank", "is_starter"]].rename(columns={"gsis_id": "player_id"}),
            on="player_id", how="left", validate="one_to_one",
        )
    identity_path = Path("data/processed/player_identity.csv")
    if identity_path.exists():
        identity = pd.read_csv(identity_path, usecols=["player_id", "player_name", "rookie_season", "birth_date"], dtype={"player_id": "string"})
        output = output.merge(identity.drop_duplicates("player_id"), on="player_id", how="left", validate="one_to_one")
    draft_path = Path("data/processed/player_draft_capital.csv")
    if draft_path.exists():
        draft = pd.read_csv(draft_path, usecols=["gsis_id", "draft_round", "draft_pick", "draft_status"], dtype={"gsis_id": "string"})
        output = output.merge(draft.drop_duplicates("gsis_id").rename(columns={"gsis_id": "player_id"}), on="player_id", how="left", validate="one_to_one")
    return output


def v2_component_rows(frame: pd.DataFrame) -> list[dict[str, float]]:
    manifest, models = load_bundle(ARTIFACT_ROOT / "v2")
    output: list[dict[str, float] | None] = [None] * len(frame)
    indexed = frame.reset_index(drop=True)
    for position, indices in indexed.groupby("historical_position").groups.items():
        idx = list(indices)
        rows = indexed.loc[idx]
        arrays = {target: np.maximum(0, model.predict(rows[manifest["features"]])) for target, model in models[position].items()}
        for local, original in enumerate(idx):
            output[original] = {target: float(values[local]) for target, values in arrays.items()}
    return [row or {} for row in output]


def build_hybrid_raw(frame: pd.DataFrame, selection: dict, v2_rows: list[dict[str, float]], v31_rows: list[dict[str, float]], direct: np.ndarray) -> list[dict[str, float]]:
    rows: list[dict[str, float]] = []
    for index, source in frame.reset_index(drop=True).iterrows():
        position = source["historical_position"]
        values = {
            target: (v31_rows[index] if provider == "v3_1" else v2_rows[index]).get(target, 0.0)
            for target, provider in selection[position].items()
        }
        values[DIRECT_TARGET] = float(direct[index])
        rows.append(values)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate local-only Model v3.1 projections with current-role arbitration.")
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--schedule", type=Path)
    parser.add_argument("--require-schedule", action="store_true")
    parser.add_argument("--artifact-dir", type=Path, default=V3_1_ARTIFACT_DIR)
    parser.add_argument("--output", type=Path, default=V3_1_PROJECTION_OUTPUT_PATH)
    args = parser.parse_args()

    historical = read_historical_stats(HISTORICAL_STATS_PATH)
    advanced = read_advanced_weekly(PBP_WEEKLY_PATH)
    schedule = resolve_schedule(args.schedule, args.require_schedule)
    inference = attach_current_context(build_v3_inference_dataset(historical, advanced, args.season, args.week, schedule)).reset_index(drop=True)
    manifest = json.loads((args.artifact_dir / "manifest.json").read_text())
    models = load_position_models(args.artifact_dir, manifest)
    features = {position: details["features"] for position, details in manifest["positions"].items()}
    candidate = predict_coherent_candidate(inference, models, features, manifest["direct_weights"])
    v2_rows = v2_component_rows(inference)
    v2_ppr = np.array([row.get(DIRECT_TARGET, 0.0) for row in v2_rows])
    if manifest["frozen_candidate"] == "global_ensemble":
        weight = float(manifest["global_ensemble_weight_v3_1"])
        frozen = v2_ppr * (1 - weight) + candidate.predictions * weight
    elif manifest["frozen_candidate"] == "position_ensemble":
        frozen = np.array([
            v2_ppr[index] * (1 - float(manifest["position_ensemble_weights_v3_1"][row.historical_position]))
            + candidate.predictions[index] * float(manifest["position_ensemble_weights_v3_1"][row.historical_position])
            for index, row in inference.iterrows()
        ])
    elif manifest["frozen_candidate"] == "component_hybrid":
        hybrid_raw = build_hybrid_raw(inference, manifest["hybrid_component_sources"], v2_rows, candidate.components, candidate.direct)
        # Opportunity targets always come from the coherent v3.1 allocation;
        # selected v2 components can contribute efficiency, never a second role
        # allocation pass.
        for index, row in enumerate(hybrid_raw):
            for target in ("pass_attempts", "rush_attempts", "targets"):
                if target in candidate.components[index]:
                    row[target] = candidate.components[index][target]
        frozen = component_ppr(
            {name: np.array([row.get(name, 0.0) for row in hybrid_raw]) for name in set().union(*(row.keys() for row in hybrid_raw))},
            len(inference),
        )
    else:
        frozen = candidate.predictions

    rows: list[dict[str, object]] = []
    for index, source in inference.iterrows():
        position = source.historical_position
        stats = {name: round(float(value), 3) for name, value in candidate.components[index].items()}
        final_ppr = round(max(0, float(frozen[index])), 3)
        stats, _ = reconcile_stat_line(stats, final_ppr, position)
        stats = {name: round(float(value), 3) for name, value in stats.items()}
        scores = default_scores(stats, position)
        role = role_confidence(source, position)
        category = history_category(source)
        residuals = manifest["residuals_by_position"][position]
        rows.append({
            "gsis_id": source.player_id, "player_name": source.get("player_name"),
            "season": args.season, "week": args.week, "season_type": "REG",
            "team": source.team if pd.notna(source.team) else None,
            "opponent_team": source.opponent_team if pd.notna(source.opponent_team) else None,
            "position": position, "depth_position": source.get("depth_position"),
            "depth_rank": source.get("depth_rank"), "is_starter": source.get("is_starter"),
            "history_category": category, "sample_weight": round(sample_weight(source, position), 4),
            "role_confidence": round(role, 4), "draft_round": source.get("draft_round"),
            "projected_stats": json.dumps(stats, sort_keys=True),
            "expected_pass_attempts": round(stats.get("pass_attempts", 0), 3),
            "expected_rush_attempts": round(stats.get("rush_attempts", 0), 3),
            "expected_targets": round(stats.get("targets", 0), 3),
            "direct_projection_ppr": round(float(candidate.direct[index]), 3),
            "pure_v3_1_projection_ppr": round(float(candidate.predictions[index]), 3),
            "model_projection_ppr": final_ppr,
            "projected_points_standard": scores["standard"],
            "projected_points_half_ppr": scores["half_ppr"],
            "projected_points_ppr": scores["ppr"],
            "floor_ppr": round(max(0, final_ppr + float(residuals["p20"])), 3),
            "median_ppr": final_ppr,
            "ceiling_ppr": round(max(0, final_ppr + float(residuals["p80"])), 3),
            "confidence": "high" if category == "17_plus_games" and role >= 0.75 else ("medium" if category not in {"zero_games", "1_3_games"} else "low"),
            "model_version": "v3_1", "feature_version": manifest["feature_version"],
            "frozen_candidate": manifest["frozen_candidate"],
        })
    output = pd.DataFrame(rows).sort_values(["position", "model_projection_ppr"], ascending=[True, False])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False)
    candidate.audit.to_csv(V3_1_COHERENCE_REPORT_PATH, index=False)
    warnings = output.loc[
        ((output.position.eq("RB")) & output.depth_rank.ge(4) & output.model_projection_ppr.gt(10))
        | ((output.position.eq("QB")) & output.depth_rank.ge(2) & output.model_projection_ppr.gt(12))
        | (output.team.isna() & output.model_projection_ppr.gt(1))
    ]
    print(f"Generated {len(output):,} local-only v3.1 projections; diagnostic warnings: {len(warnings):,}.")
    if len(warnings):
        print(warnings[["player_name", "position", "depth_rank", "model_projection_ppr", "expected_rush_attempts", "expected_targets", "expected_pass_attempts"]].to_string(index=False))
    print(f"Output: {args.output}")
    print(f"Team coherence: {V3_1_COHERENCE_REPORT_PATH}")
    print("Dry-run only: production v2 and Supabase were not changed.")


if __name__ == "__main__":
    main()
