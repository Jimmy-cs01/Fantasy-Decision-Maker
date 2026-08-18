#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

if __package__:
    from .generate_weekly_projections import resolve_schedule
    from .projection_pipeline.config import ARTIFACT_ROOT, HISTORICAL_STATS_PATH
    from .projection_pipeline.features import read_historical_stats
    from .projection_pipeline.model import projection_drivers, residual_interval
    from .projection_pipeline.scoring import default_scores, reconcile_stat_line
    from .projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_PROJECTION_OUTPUT_PATH
    from .projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly
    from .projection_pipeline.v3_model import component_ppr, load_v3_bundle, predict_v3_targets
else:
    from generate_weekly_projections import resolve_schedule
    from projection_pipeline.config import ARTIFACT_ROOT, HISTORICAL_STATS_PATH
    from projection_pipeline.features import read_historical_stats
    from projection_pipeline.model import projection_drivers, residual_interval
    from projection_pipeline.scoring import default_scores, reconcile_stat_line
    from projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_PROJECTION_OUTPUT_PATH
    from projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly
    from projection_pipeline.v3_model import component_ppr, load_v3_bundle, predict_v3_targets


def v3_confidence(row: pd.Series, features: list[str], residual_width: float) -> str:
    advanced = [feature for feature in features if feature.startswith((
        "dropbacks_", "pbp_", "team_", "red_zone_", "inside_", "goal_line_",
        "target_", "rush_", "backfield_", "pass_", "cpoe_", "sack_",
    ))]
    coverage = float(row[advanced].notna().mean()) if advanced else 0.0
    games = float(row.get("career_games_before", 0) or 0)
    if games >= 8 and coverage >= 0.75 and residual_width <= 16:
        return "high"
    if games >= 4 and coverage >= 0.4:
        return "medium"
    return "low"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate experimental Model v3 projections (local dry-run output).")
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--version", default="v3")
    parser.add_argument("--schedule", type=Path)
    parser.add_argument("--require-schedule", action="store_true")
    parser.add_argument("--output", type=Path, default=V3_PROJECTION_OUTPUT_PATH)
    args = parser.parse_args()
    if args.version in {"v1", "v2"}:
        raise ValueError("The v3 generator will not overwrite v1/v2 outputs")

    historical = read_historical_stats(HISTORICAL_STATS_PATH)
    advanced = read_advanced_weekly(PBP_WEEKLY_PATH)
    schedule = resolve_schedule(args.schedule, args.require_schedule)
    inference = build_v3_inference_dataset(historical, advanced, args.season, args.week, schedule)
    manifest, models = load_v3_bundle(ARTIFACT_ROOT / args.version)
    rows: list[dict[str, object]] = []
    for position, position_frame in inference.groupby("historical_position"):
        if position not in models:
            continue
        details = manifest["positions"][position]
        features = details["features"]
        predictions = predict_v3_targets(models[position], position_frame, features)
        component_values = component_ppr(predictions, len(position_frame))
        for index, (_, source) in enumerate(position_frame.iterrows()):
            stats = {
                target: round(float(values[index]), 3)
                for target, values in predictions.items()
                if target != "fantasy_points_ppr"
            }
            direct_ppr = float(predictions["fantasy_points_ppr"][index])
            component_projection = float(component_values[index])
            component_weight = float(details.get("component_ppr_weight", 0))
            model_ppr = round(
                max(
                    0,
                    direct_ppr * (1 - component_weight)
                    + component_projection * component_weight,
                ),
                3,
            )
            stats, factor = reconcile_stat_line(stats, model_ppr, position)
            stats = {key: round(value, 3) for key, value in stats.items()}
            scores = default_scores(stats, position)
            low, high = residual_interval(details, model_ppr)
            rows.append({
                "gsis_id": source.player_id,
                "season": args.season,
                "week": args.week,
                "season_type": "REG",
                "team": source.team if pd.notna(source.team) else None,
                "opponent_team": source.opponent_team if pd.notna(source.opponent_team) else None,
                "position": position,
                "projected_stats": json.dumps(stats, sort_keys=True),
                "model_projection_ppr": model_ppr,
                "projected_points_standard": scores["standard"],
                "projected_points_half_ppr": scores["half_ppr"],
                "projected_points_ppr": scores["ppr"],
                "floor_ppr": round(max(0, model_ppr + low), 3),
                "median_ppr": model_ppr,
                "ceiling_ppr": round(max(0, model_ppr + high), 3),
                "residual_low": round(low, 3),
                "residual_high": round(high, 3),
                "confidence": v3_confidence(source, features, high - low),
                "drivers": json.dumps((
                    projection_drivers(source)
                    + (["PBP opportunity components were calibrated to the direct fantasy projection"] if abs(factor - 1) >= 0.15 else [])
                )[:3]),
                "model_version": args.version,
                "feature_version": manifest["feature_version"],
            })
    output = pd.DataFrame(rows).sort_values(["position", "model_projection_ppr"], ascending=[True, False])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False)
    scheduled = int(output["opponent_team"].notna().sum()) if len(output) else 0
    print(f"Generated {len(output):,} experimental {args.version} projections ({scheduled:,} with matchup data).")
    print(f"Output: {args.output}")
    print("Dry-run only: no Supabase rows were written and production v2 is unchanged.")


if __name__ == "__main__":
    main()
