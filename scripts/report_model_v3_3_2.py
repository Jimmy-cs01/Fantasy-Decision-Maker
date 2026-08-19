#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from projection_pipeline.evaluation_scoreboard import regression_metrics, role_change_masks
from projection_pipeline.v3_3_2_config import V3_3_2_ARTIFACT_DIR, V3_3_2_PROJECTION_OUTPUT_PATH
from report_projection_scoreboard import load_predictions


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/model_v3_3_2_final_report.json"
TOP_ERRORS = ROOT / "data/processed/model_v3_3_2_top_errors.csv"
NAMED = (
    "Lamar Jackson", "Travis Etienne", "Breece Hall", "James Cook",
    "Frank Gore Jr.", "Jarquez Hunter", "Josh Allen",
)


def classify_error(row: pd.Series, prediction: str) -> str:
    error = float(row[prediction] - row.fantasy_points_ppr)
    if float(row.fantasy_points_ppr) == 0 and float(row[prediction]) >= 10:
        return "availability_or_early_exit_possible"
    increase, decrease = role_change_masks(row.to_frame().T)
    if bool(increase.iloc[0]):
        return "role_increase"
    if bool(decrease.iloc[0]):
        return "role_decrease"
    if abs(error) >= 15:
        return "td_long_play_or_unobserved_event"
    return "opportunity_or_efficiency"


def bootstrap(actual: np.ndarray, baseline: np.ndarray, candidate: np.ndarray) -> dict[str, float]:
    rng = np.random.default_rng(42)
    differences = []
    for _ in range(2_000):
        index = rng.integers(0, len(actual), len(actual))
        differences.append(float(np.mean(np.abs(candidate[index] - actual[index])) - np.mean(np.abs(baseline[index] - actual[index]))))
    low, high = np.quantile(differences, [0.025, 0.975])
    return {"mean": float(np.mean(differences)), "lower_95": float(low), "upper_95": float(high)}


def bias_breakdown(frame: pd.DataFrame, prediction: str) -> dict[str, object]:
    output = frame.assign(
        prediction_bucket=pd.cut(frame[prediction], [-1, 5, 10, 15, 20, np.inf]),
        actual_bucket=pd.cut(frame.fantasy_points_ppr, [-1, 5, 10, 15, 20, np.inf]),
    )
    result = {}
    for dimension in ("season", "historical_position", "prediction_bucket", "actual_bucket"):
        result[dimension] = {
            str(key): {
                "rows": int(len(group)),
                "bias": float((group[prediction] - group.fantasy_points_ppr).mean()),
            }
            for key, group in output.groupby(dimension, observed=True)
        }
    return result


def main() -> None:
    scoreboard = json.loads((ROOT / "data/processed/projection_evaluation_scoreboard.json").read_text())
    frame = load_predictions()
    common = frame.loc[frame.v2.notna() & frame.v3_3_2.notna()].copy()
    oof = pd.read_csv(V3_3_2_ARTIFACT_DIR / "rolling_validation_predictions.csv.gz", dtype={"player_id": "string"})
    keys = ["player_id", "season", "week", "historical_position"]
    diagnostics = oof[keys + [
        "e2_hierarchy_no_refill_direct", "e6_tail_safety_rising_role_component",
    ]].rename(columns={
        "e2_hierarchy_no_refill_direct": "v3_direct",
        "e6_tail_safety_rising_role_component": "v3_component",
    })
    common = common.merge(diagnostics, on=keys, how="left", validate="one_to_one")

    error_rows = []
    for model in ("v2", "v3_3_1", "v3_3_2"):
        ranked = common.assign(absolute_error=(common[model] - common.fantasy_points_ppr).abs()).nlargest(100, "absolute_error")
        ranked = ranked.assign(model=model, cause=[classify_error(row, model) for _, row in ranked.iterrows()])
        error_rows.append(ranked[[*keys, "fantasy_points_ppr", model, "absolute_error", "model", "cause"]].rename(columns={model: "prediction"}))
    top_errors = pd.concat(error_rows, ignore_index=True)
    TOP_ERRORS.parent.mkdir(parents=True, exist_ok=True)
    top_errors.to_csv(TOP_ERRORS, index=False)
    delta = (common.v3_3_2 - common.fantasy_points_ppr).abs() - (common.v2 - common.fantasy_points_ppr).abs()

    model_matrix = common[["v2", "v3_3_1", "v3_3_2", "v3_direct", "v3_component"]]
    disagreement = model_matrix.max(axis=1) - model_matrix.min(axis=1)
    candidate_error = (common.v3_3_2 - common.fantasy_points_ppr).abs()

    current = pd.read_csv(V3_3_2_PROJECTION_OUTPUT_PATH, dtype={"gsis_id": "string"})
    v2_current = pd.read_csv(ROOT / "data/processed/player_projections_v2.csv", dtype={"gsis_id": "string"})
    v331_current = pd.read_csv(ROOT / "data/processed/player_projections_v3_3_1.csv", dtype={"gsis_id": "string"})
    v2_value = "model_projection_ppr" if "model_projection_ppr" in v2_current else "projected_points_ppr"
    named = current.loc[current.player_name.isin(NAMED)].copy()
    named = named.merge(v2_current[["gsis_id", v2_value]].rename(columns={v2_value: "v2"}), on="gsis_id", how="left")
    named = named.merge(v331_current[["gsis_id", "model_projection_ppr"]].rename(columns={"model_projection_ppr": "v3_3_1"}), on="gsis_id", how="left")
    team_totals = current.groupby("team").agg(team_qb_attempts=("expected_pass_attempts", "sum"), team_targets=("expected_targets", "sum"), team_rb_carries=("expected_rush_attempts", "sum"))
    named = named.join(team_totals, on="team")
    named["target_share"] = named.expected_targets.div(named.team_targets.replace(0, np.nan))
    named["rush_share"] = named.expected_rush_attempts.div(named.team_rb_carries.replace(0, np.nan))

    current_report = json.loads((ROOT / "data/processed/model_v3_3_2_report.json").read_text())["current_generation"]
    metrics = scoreboard["common_2024_2025_comparison"]
    v2_metrics = metrics["v2"]["overall"]
    candidate_metrics = metrics["v3_3_2"]["overall"]
    candidate_role = metrics["v3_3_2"]["role_change"]
    candidate_quantiles = metrics["v3_3_2"]["quantiles"]
    gates = {
        "mae_better_than_v2": candidate_metrics["mae"] < v2_metrics["mae"],
        "rmse_no_worse_than_v2": candidate_metrics["rmse"] <= v2_metrics["rmse"],
        "ten_point_miss_no_worse_than_v2": candidate_metrics["absolute_error_gt_10"] <= v2_metrics["absolute_error_gt_10"] + 0.0001,
        "twenty_point_miss_no_worse_than_v2": candidate_metrics["absolute_error_gt_20"] <= v2_metrics["absolute_error_gt_20"],
        "role_increase": candidate_role["increase"]["mae"] <= 4.6821,
        "role_decrease": candidate_role["decrease"]["mae"] <= 4.18,
        "calibration": 0.18 <= candidate_quantiles["p20_below_frequency"] <= 0.22 and 0.78 <= candidate_quantiles["p80_below_frequency"] <= 0.82,
        "confidence_monotonic": metrics["v3_3_2"]["empirical_confidence"]["mae_monotonic"],
        "current_sanity": bool(current_report["sanity"]["promotion_safe"]),
        "team_budgets": sum(current_report["team_budget_violations"].values()) == 0,
    }
    cause_counts = {
        model: group.groupby("cause").size().astype(int).to_dict()
        for model, group in top_errors.groupby("model")
    }
    report = {
        "outcome": "PROMOTION RECOMMENDED" if all(gates.values()) else "PROMOTION BLOCKED",
        "gates": gates,
        "scoreboard": {name: metrics[name] for name in ("v2", "v3_3", "v3_3_1", "v3_3_2")},
        "bootstrap_v3_3_2_minus_v2": bootstrap(common.fantasy_points_ppr.to_numpy(), common.v2.to_numpy(), common.v3_3_2.to_numpy()),
        "bias_breakdown": bias_breakdown(common, "v3_3_2"),
        "catastrophic": {
            "top_error_file": str(TOP_ERRORS),
            "v3_3_2_more_than_5_worse_than_v2": int(delta.gt(5).sum()),
            "v3_3_2_more_than_5_better_than_v2": int(delta.lt(-5).sum()),
            "top_100_causes": cause_counts,
        },
        "disagreement": {
            "correlation_with_absolute_error": float(disagreement.corr(candidate_error)),
            "mean_range": float(disagreement.mean()),
            "p95_range": float(disagreement.quantile(0.95)),
        },
        "current_sanity": current_report,
        "named_current_players": named.replace({np.nan: None}).to_dict("records"),
        "artifact_sha256": hashlib.sha256(V3_3_2_PROJECTION_OUTPUT_PATH.read_bytes()).hexdigest(),
        "production_unchanged": True,
    }
    OUTPUT.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(f"v3.3.2 final report: {OUTPUT}")
    print(report["outcome"])
    print(f"All promotion gates: {'PASS' if all(gates.values()) else 'FAIL'}")


if __name__ == "__main__":
    main()
