#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

REPORT = Path("data/processed/model_v3_2_report.json")
COMPARISON = Path("data/processed/model_v3_2_comparison.csv")


def main() -> None:
    report = json.loads(REPORT.read_text())
    print("Rolling folds:", report["rolling_folds"])
    print("Selected snap experiment:", report["selected_snap_experiment"])
    print("Selected snap features:", report["selected_snap_features"])
    print("Overall:")
    for name, metrics in report["overall"].items():
        print(f"  {name:20s} MAE {metrics['mae']:.4f} RMSE {metrics['rmse']:.4f} r {metrics['correlation']:.4f}")
    print("Bootstrap candidate-v3.1:", report["bootstrap_candidate_minus_v3_1"])
    print("Preliminary statistical gate:", "YES" if report["promotion_preliminary"] else "NO")
    print("Final promotion gate:", "YES" if report.get("promotion_recommended") else "NO")
    if report.get("promotion_blockers"):
        print("Blockers:", "; ".join(report["promotion_blockers"]))
    print("Experiment aggregate:")
    print(pd.DataFrame(report["experiment_aggregate"])[["experiment", "mae", "rmse", "correlation"]].sort_values("mae").to_string(index=False))
    if COMPARISON.exists():
        frame = pd.read_csv(COMPARISON)
        names = [
            "Christian McCaffrey", "Jahmyr Gibbs", "Justin Jefferson", "Ja'Marr Chase",
            "Trey McBride", "Brock Bowers", "Colston Loveland", "Frank Gore Jr.",
            "Jarquez Hunter", "Josh Allen",
        ]
        columns = [column for column in [
            "player_name", "position", "team", "depth_rank", "recent_snap_pct",
            "rolling_3_snap_pct", "v2", "v3_1", "v3_2", "difference_vs_v3_1",
            "v3_1_rush_attempts", "expected_rush_attempts", "v3_1_targets", "expected_targets",
        ] if column in frame]
        print("Current named sanity:")
        print(frame.loc[frame.player_name.isin(names), columns].sort_values("player_name").to_string(index=False))
        print("Largest increases:")
        print(frame.nlargest(10, "difference_vs_v3_1")[["player_name", "position", "depth_rank", "v3_1", "v3_2", "difference_vs_v3_1"]].to_string(index=False))
        print("Largest decreases:")
        print(frame.nsmallest(10, "difference_vs_v3_1")[["player_name", "position", "depth_rank", "v3_1", "v3_2", "difference_vs_v3_1"]].to_string(index=False))


if __name__ == "__main__":
    main()
