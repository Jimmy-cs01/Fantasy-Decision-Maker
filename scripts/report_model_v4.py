#!/usr/bin/env python3
"""Freeze validation-selected v3.3.2/v4 candidates and report deployment gates."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from projection_pipeline.evaluation_scoreboard import (
    chronological_empirical_confidence, chronological_quantile_calibration,
    ranking_metrics, regression_metrics, role_change_report,
)

ROOT = Path(__file__).resolve().parents[1]
OOF = ROOT / "data/processed/model_v4_oof.csv.gz"
OUTPUT = ROOT / "data/processed/model_v4_final_report.json"
CANDIDATE = "v4_d_rookie"
WEIGHTS = np.arange(0, .81, .05)


def bootstrap_difference(frame, candidate, samples=2000, seed=42):
    rng = np.random.default_rng(seed)
    actual = frame.fantasy_points_ppr.to_numpy(float)
    base = np.abs(frame.v3_3_2.to_numpy(float) - actual)
    trial = np.abs(frame[candidate].to_numpy(float) - actual)
    differences = np.empty(samples)
    for index in range(samples):
        draw = rng.integers(0, len(frame), len(frame))
        differences[index] = (trial[draw] - base[draw]).mean()
    return {"mean": round(float(differences.mean()), 4), "p025": round(float(np.quantile(differences, .025)), 4),
            "p975": round(float(np.quantile(differences, .975)), 4)}


def main():
    frame = pd.read_csv(OOF, low_memory=False)
    tuning = frame.loc[frame.season.le(2024)]
    scored = []
    for weight in WEIGHTS:
        prediction = tuning.v3_3_2 * (1 - weight) + tuning[CANDIDATE] * weight
        metrics = regression_metrics(tuning.fantasy_points_ppr, prediction)
        scored.append((metrics["mae"], metrics["absolute_error_gt_20"], float(weight)))
    _, _, weight = min(scored)
    frame["v4_frozen_ensemble"] = frame.v3_3_2 * (1 - weight) + frame[CANDIDATE] * weight
    names = ["v3_3_2", CANDIDATE, "v4_frozen_ensemble"]
    report = {
        "selection": {"candidate": CANDIDATE, "weight": weight, "selected_on": "2022-2024 only", "test_year": 2025},
        "overall": {name: regression_metrics(frame.fantasy_points_ppr, frame[name]) for name in names},
        "test_2025": {name: regression_metrics(frame.loc[frame.season.eq(2025), "fantasy_points_ppr"], frame.loc[frame.season.eq(2025), name]) for name in names},
        "folds": {str(year): {name: regression_metrics(group.fantasy_points_ppr, group[name]) for name in names} for year, group in frame.groupby("season")},
        "positions": {position: {name: regression_metrics(group.fantasy_points_ppr, group[name]) for name in names} for position, group in frame.groupby("historical_position")},
        "role_change": {name: role_change_report(frame, name) for name in names},
        "calibration": {name: chronological_quantile_calibration(frame, name) for name in names},
        "ranking": {name: ranking_metrics(frame, name) for name in names},
        "confidence": {
            name: chronological_empirical_confidence(
                frame.drop(columns=[c for c in ("position", "projection_band", "history_band", "stable_role") if c in frame]),
                name,
            )
            for name in names
        },
        "bootstrap_mae_difference_vs_v3_3_2": bootstrap_difference(frame, "v4_frozen_ensemble"),
        "promotion_gates": {
            "mae_better": None, "rmse_not_worse": None, "tail_20_not_worse": None,
            "all_positions_not_worse": None, "role_change_not_worse": None,
        },
        "production_unchanged": True,
    }
    base, trial = report["overall"]["v3_3_2"], report["overall"]["v4_frozen_ensemble"]
    report["promotion_gates"].update({
        "mae_better": trial["mae"] < base["mae"],
        "rmse_not_worse": trial["rmse"] <= base["rmse"],
        "tail_20_not_worse": trial["absolute_error_gt_20"] <= base["absolute_error_gt_20"],
        "all_positions_not_worse": all(report["positions"][p]["v4_frozen_ensemble"]["mae"] <= report["positions"][p]["v3_3_2"]["mae"] for p in report["positions"]),
        "role_change_not_worse": all(report["role_change"]["v4_frozen_ensemble"][s]["mae"] <= report["role_change"]["v3_3_2"][s]["mae"] for s in ("increase", "decrease")),
    })
    report["promotion_recommended"] = all(report["promotion_gates"].values())
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"selection": report["selection"], "overall": report["overall"], "gates": report["promotion_gates"], "promotion_recommended": report["promotion_recommended"]}, indent=2))


if __name__ == "__main__":
    main()
