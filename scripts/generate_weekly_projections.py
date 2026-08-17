#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

if __package__:
    from .projection_pipeline.config import ARTIFACT_ROOT, HISTORICAL_STATS_PATH, PROJECTION_OUTPUT_PATH, SCHEDULE_OUTPUT_PATH
    from .projection_pipeline.features import build_inference_dataset, read_historical_stats
    from .projection_pipeline.model import confidence_for, load_bundle, predict_targets, projection_drivers, residual_interval
    from .projection_pipeline.schedules import read_normalized_schedule
    from .projection_pipeline.scoring import default_scores, reconcile_stat_line
else:
    from projection_pipeline.config import ARTIFACT_ROOT, HISTORICAL_STATS_PATH, PROJECTION_OUTPUT_PATH, SCHEDULE_OUTPUT_PATH
    from projection_pipeline.features import build_inference_dataset, read_historical_stats
    from projection_pipeline.model import confidence_for, load_bundle, predict_targets, projection_drivers, residual_interval
    from projection_pipeline.schedules import read_normalized_schedule
    from projection_pipeline.scoring import default_scores, reconcile_stat_line


def resolve_schedule(
    override: Path | None,
    require_schedule: bool,
    default_path: Path = SCHEDULE_OUTPUT_PATH,
) -> pd.DataFrame | None:
    if override:
        return pd.read_csv(override, dtype={"player_id": "string", "team": "string"})
    if default_path.exists():
        return read_normalized_schedule(default_path)
    if require_schedule:
        raise FileNotFoundError(
            f"Schedule context required. Run npm run data:schedules or pass --schedule. Missing: {default_path}"
        )
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate idempotent weekly player projections.")
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--version", default="v1")
    parser.add_argument("--schedule", type=Path, help="Optional CSV with player_id and opponent_team.")
    parser.add_argument("--require-schedule", action="store_true")
    parser.add_argument("--output", type=Path, default=PROJECTION_OUTPUT_PATH)
    args = parser.parse_args()

    raw = read_historical_stats(HISTORICAL_STATS_PATH)
    schedule = resolve_schedule(args.schedule, args.require_schedule)
    if schedule is None:
        print(f"Warning: no normalized schedule at {SCHEDULE_OUTPUT_PATH}; generating without matchup context.")
    inference = build_inference_dataset(raw, args.season, args.week, schedule)
    artifact_dir = ARTIFACT_ROOT / args.version
    manifest, models = load_bundle(artifact_dir)
    rows: list[dict] = []
    for position, position_frame in inference.groupby("historical_position"):
        if position not in models:
            continue
        details = manifest["positions"][position]
        predictions = predict_targets(models[position], position_frame, manifest["features"])
        for index, (_, source) in enumerate(position_frame.iterrows()):
            stats = {
                target: round(float(values[index]), 3)
                for target, values in predictions.items()
                if target != "fantasy_points_ppr"
            }
            direct_ppr = round(float(predictions["fantasy_points_ppr"][index]), 3)
            stats, calibration_factor = reconcile_stat_line(stats, direct_ppr, position)
            stats = {key: round(value, 3) for key, value in stats.items()}
            scores = default_scores(stats, position)
            low, high = residual_interval(details, direct_ppr)
            width = high - low
            rows.append({
                "gsis_id": source.player_id,
                "season": args.season,
                "week": args.week,
                "season_type": "REG",
                "team": source.team if pd.notna(source.team) else None,
                "opponent_team": source.opponent_team if pd.notna(source.opponent_team) else None,
                "position": position,
                "projected_stats": json.dumps(stats, sort_keys=True),
                "model_projection_ppr": direct_ppr,
                "projected_points_standard": scores["standard"],
                "projected_points_half_ppr": scores["half_ppr"],
                "projected_points_ppr": scores["ppr"],
                "floor_ppr": round(max(0, direct_ppr + low), 3),
                "median_ppr": direct_ppr,
                "ceiling_ppr": round(max(0, direct_ppr + high), 3),
                "residual_low": round(low, 3),
                "residual_high": round(high, 3),
                "confidence": confidence_for(source, width),
                "drivers": json.dumps((
                    projection_drivers(source)
                    + (["Component stat models were calibrated to the direct fantasy projection"] if abs(calibration_factor - 1) >= 0.15 else [])
                )[:3]),
                "model_version": args.version,
            })
    output = pd.DataFrame(rows).sort_values(["position", "model_projection_ppr"], ascending=[True, False])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False)
    scheduled = int(output.opponent_team.notna().sum()) if len(output) else 0
    print(f"Generated {len(output):,} projections for {args.season} week {args.week} ({scheduled:,} with matchup data).")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
