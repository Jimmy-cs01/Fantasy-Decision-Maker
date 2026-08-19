#!/usr/bin/env python3
"""Permanent scoreboard for the SNAP-first model tournament."""
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
OOF = ROOT / "data/processed/model_snap_first_oof.csv.gz"
TOURNAMENT = ROOT / "data/processed/model_snap_first_tournament.json"
CURRENT = ROOT / "data/processed/model_snap_first_current_sanity.json"
OUTPUT = ROOT / "data/processed/model_snap_first_final_report.json"
SEED = 42


def bootstrap_delta(frame: pd.DataFrame, baseline: str, candidate: str, samples: int = 2000) -> dict:
    actual = frame.fantasy_points_ppr.to_numpy(float)
    base = np.abs(frame[baseline].to_numpy(float) - actual)
    test = np.abs(frame[candidate].to_numpy(float) - actual)
    rng = np.random.default_rng(SEED)
    deltas = np.empty(samples)
    for index in range(samples):
        selected = rng.integers(0, len(frame), len(frame))
        deltas[index] = (test[selected] - base[selected]).mean()
    low, high = np.quantile(deltas, [.025, .975])
    return {"samples": samples, "mean_mae_delta": round(float(deltas.mean()), 5), "ci95": [round(float(low), 5), round(float(high), 5)]}


def main() -> None:
    frame = pd.read_csv(OOF, dtype={"player_id": "string"}, low_memory=False)
    confidence_frame = frame.drop(columns=["position", "projection_band", "history_band", "stable_role"], errors="ignore")
    tournament = json.loads(TOURNAMENT.read_text())
    current = json.loads(CURRENT.read_text())
    candidate = "ensemble_v4_2_snap_persistence"
    masks = {
        "high_volume_rb": frame.historical_position.eq("RB") & frame.rush_attempts.ge(15),
        "high_volume_wr": frame.historical_position.eq("WR") & frame.targets.ge(8),
        "high_volume_te": frame.historical_position.eq("TE") & frame.targets.ge(6),
        "high_rush_qb": frame.historical_position.eq("QB") & frame.rush_attempts.ge(5),
        "stable_established": frame.stable_role_prior.eq(1) & frame.career_games_before.ge(17),
        "low_history": frame.career_games_before.lt(9),
        "rookie": frame.career_games_before.eq(0),
    }
    report = {
        "outcome": "RETAIN v3.3.2 — SNAP-first candidate did not clear current-calibration gates",
        "candidate": candidate,
        "scoreboard": {name: regression_metrics(frame.fantasy_points_ppr, frame[name]) for name in ["v3_3_2", "ensemble_v4_1_baseline", candidate]},
        "positions": {position: {name: regression_metrics(rows.fantasy_points_ppr, rows[name]) for name in ["v3_3_2", candidate]} for position, rows in frame.groupby("historical_position")},
        "role_change": {name: role_change_report(frame, name) for name in ["v3_3_2", candidate]},
        "cohorts": {label: {name: regression_metrics(frame.loc[mask, "fantasy_points_ppr"], frame.loc[mask, name]) for name in ["v3_3_2", candidate]} for label, mask in masks.items()},
        "ranking": {name: ranking_metrics(frame, name) for name in ["v3_3_2", candidate]},
        "calibration": {name: chronological_quantile_calibration(frame, name) for name in ["v3_3_2", candidate]},
        "confidence": chronological_empirical_confidence(confidence_frame, candidate),
        "bootstrap_vs_v3_3_2": bootstrap_delta(frame, "v3_3_2", candidate),
        "snap_model": {
            "selected_family": tournament["selected_projected_snap_family_pre2025"],
            "validation_2022_2024": tournament["snap_validation_2022_2024"],
            "test_2025": tournament["snap_test_2025"],
        },
        "training_windows": {name: tournament["overall"][name] for name in ["ensemble_v4_2_snap_persistence", "ensemble_v4_2_snap_persistence_start_2019", "ensemble_v4_2_snap_persistence_start_2020"]},
        "current_sanity": current,
        "promotion": {"recommended": False, "production_model": "v3.3.2", "reason": "33 stable high-snap starter suppressions remained in the best-accuracy candidate; the safety blend reduced them but did not beat the prior frozen v4.1 benchmark."},
        "production_projection_rows_changed": 0,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"outcome": report["outcome"], "scoreboard": report["scoreboard"], "bootstrap": report["bootstrap_vs_v3_3_2"], "current_gates": {key: current[key] for key in ["component_ppr_mismatches", "negative_components", "rb4_above_8", "teamless_above_1", "starting_qb_below_8", "starting_qb_below_18_attempts", "team_target_pass_violations", "stable_high_snap_suppression"]}}, indent=2))


if __name__ == "__main__":
    main()
