#!/usr/bin/env python3
from __future__ import annotations

import json

import pandas as pd

from projection_pipeline.v3_3_config import V3_3_COMPARISON_PATH, V3_3_REPORT_PATH


def main() -> None:
    report = json.loads(V3_3_REPORT_PATH.read_text())
    print("Experiments:")
    for name, values in report["overall"].items():
        print(f"  {name:25s} MAE {values['mae']:.4f} RMSE {values['rmse']:.4f} r {values['correlation']:.4f}")
    print("Mandatory gates:", report["mandatory_gates"])
    print("Current sanity:", report.get("current_sanity", "not generated"))
    print("PROMOTION RECOMMENDED:", "YES" if report.get("promotion_recommended") else "NO")
    if V3_3_COMPARISON_PATH.exists():
        comparison = pd.read_csv(V3_3_COMPARISON_PATH)
        names = [
            "Christian McCaffrey", "Jahmyr Gibbs", "Justin Jefferson", "Ja'Marr Chase",
            "Trey McBride", "Brock Bowers", "Colston Loveland", "Frank Gore Jr.",
            "Jarquez Hunter", "Josh Allen",
        ]
        columns = [
            "player_name", "position", "depth_rank", "recent_snap_pct", "rolling_3_snap_pct",
            "recent_opportunities", "role_increase", "role_decrease", "established_starter",
            "v3_1", "v3_2", "v3_3", "delta_vs_v3_2", "component_derived_ppr",
        ]
        print(comparison.loc[comparison.player_name.isin(names), columns].sort_values("player_name").to_string(index=False))


if __name__ == "__main__":
    main()

