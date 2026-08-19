#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from projection_pipeline.evaluation_scoreboard import ACTUAL_COLUMN, evaluate_model


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data/processed/projection_evaluation_scoreboard.json"


def load_predictions() -> pd.DataFrame:
    v33 = pd.read_csv(ROOT / "artifacts/projections/v3_3/rolling_validation_predictions.csv.gz", dtype={"player_id": "string"})
    v331 = pd.read_csv(ROOT / "artifacts/projections/v3_3_1/rolling_validation_predictions.csv.gz", dtype={"player_id": "string"})
    v332 = pd.read_csv(ROOT / "artifacts/projections/v3_3_2/rolling_validation_predictions.csv.gz", dtype={"player_id": "string"})
    keys = ["player_id", "season", "week", "historical_position"]
    frame = v33.merge(v331[keys + ["v3_3_1"]], on=keys, how="left", validate="one_to_one")
    frame = frame.merge(
        v332[keys + ["e6_tail_safety_rising_role"]].rename(
            columns={"e6_tail_safety_rising_role": "v3_3_2"},
        ),
        on=keys,
        how="left",
        validate="one_to_one",
    )

    features = pd.read_csv(
        ROOT / "data/processed/player_week_projection_features_v3_2.csv.gz",
        usecols=lambda column: column in {
            *keys, "fantasy_points_ppr_season_avg", "is_starter", "depth_rank",
        },
        dtype={"player_id": "string"},
    )
    frame = frame.merge(features, on=keys, how="left", validate="one_to_one")

    historical = []
    for path in (
        ROOT / "artifacts/projections/v3_1/validation_predictions.csv.gz",
        ROOT / "artifacts/projections/v3_1/test_predictions.csv.gz",
    ):
        if path.exists():
            historical.append(pd.read_csv(path, dtype={"player_id": "string"}))
    if historical:
        baseline = pd.concat(historical, ignore_index=True)[keys + ["v2"]].drop_duplicates(keys)
        frame = frame.merge(baseline, on=keys, how="left", validate="one_to_one")
    return frame


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the permanent chronological Jimmy GM projection scoreboard.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    frame = load_predictions()
    v332_report_path = ROOT / "data/processed/model_v3_3_2_report.json"
    v332_report = json.loads(v332_report_path.read_text()) if v332_report_path.exists() else {}
    model_columns = [name for name in ("v2", "v3_1", "v3_2", "e2_rising_protection", "e3_starter_anchor", "v3_3", "v3_3_1", "v3_3_2") if name in frame]
    common_v2 = frame.loc[frame.v2.notna()].copy() if "v2" in frame else frame.iloc[0:0].copy()
    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "production_model_unchanged": True,
        "source": "saved leakage-safe rolling validation predictions",
        "models": {name: evaluate_model(frame, name) for name in model_columns},
        "common_2024_2025_comparison": {
            name: evaluate_model(common_v2, name)
            for name in model_columns
            if common_v2[name].notna().any()
        },
        "cohorts": {
            "rolling_2022_2025_rows": int(len(frame)),
            "v2_comparable_2024_2025_rows": int(frame.v2.notna().sum()) if "v2" in frame else 0,
        },
        "team_coherence": {
            "historical_rolling": v332_report.get("passing_coherence", {}),
            "current_2026_week_1": v332_report.get("current_generation", {}).get("passing_coherence", {}),
            "current_budget_violations": v332_report.get("current_generation", {}).get("team_budget_violations", {}),
            "current_stale_team_rows": 0,
        },
        "limitations": [
            "Historical opportunity-component predictions were not persisted for every model, so opportunity MAE is not yet available in this report.",
            "Start/sit pairs compare same-position players within each historical week; actual fantasy lineup ownership was not available.",
            "Quantiles use expanding-window residual calibration because saved rolling artifacts do not contain fold-specific quantile models.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Projection scoreboard: {args.output}")
    for name, details in report["models"].items():
        overall = details["overall"]
        role = details["role_change"]
        quantiles = details["quantiles"]
        print(
            f"{name:22s} rows={overall['rows']:5d} MAE={overall['mae']:.4f} RMSE={overall['rmse']:.4f} "
            f">10={overall['absolute_error_gt_10']:.3%} rise={role['increase'].get('mae')} "
            f"fall={role['decrease'].get('mae')} P20={quantiles.get('p20_below_frequency')} P80={quantiles.get('p80_below_frequency')}"
        )
    print("Production model and Supabase were not changed.")


if __name__ == "__main__":
    main()
