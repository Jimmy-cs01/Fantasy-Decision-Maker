#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from projection_pipeline.v3_3_config import V3_3_COMPARISON_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description="Explain a local v3.3 correction-layer projection.")
    parser.add_argument("--player", required=True)
    parser.add_argument("--full", action="store_true", help="Print the complete forensic inference trace.")
    args = parser.parse_args()
    if args.full:
        report_path = Path("data/processed/model_v3_3_forensic_report.json")
        if not report_path.exists():
            raise SystemExit("Run python3 scripts/report_model_v3_3_forensics.py first.")
        traces = json.loads(report_path.read_text())["traces"]
        matches = [trace for trace in traces if args.player.lower() in trace["identity"]["player"].lower()]
        if not matches:
            raise SystemExit(f"No forensic v3.3 trace found for {args.player!r}")
        print(json.dumps(matches, indent=2))
        return
    frame = pd.read_csv(V3_3_COMPARISON_PATH)
    matches = frame.loc[frame.player_name.fillna("").str.contains(args.player, case=False, regex=False)]
    if matches.empty:
        raise SystemExit(f"No v3.3 projection found for {args.player!r}")
    for _, row in matches.iterrows():
        print(f"{row.player_name} ({row.position}, {row.team if pd.notna(row.team) else 'FA'})")
        print(f"  Depth rank: {row.depth_rank if pd.notna(row.depth_rank) else 'unknown'}")
        print(f"  Shifted snaps: previous={row.recent_snap_pct if pd.notna(row.recent_snap_pct) else 'missing'}; rolling-3={row.rolling_3_snap_pct if pd.notna(row.rolling_3_snap_pct) else 'missing'}")
        print(f"  Recent opportunity: {row.recent_opportunities if pd.notna(row.recent_opportunities) else 'missing'}")
        print(f"  State: rising={row.role_increase}; declining={row.role_decrease}; established={row.established_starter}")
        print(f"  v3.1={row.v3_1:.3f}; v3.2={row.v3_2:.3f}; v3.3={row.v3_3:.3f}; correction={row.delta_vs_v3_2:+.3f}")
        print(f"  Exact component PPR={row.component_derived_ppr:.6f}; mode={row.reconciliation_mode}")
        print(f"  Components: {json.dumps(json.loads(row.projected_stats), sort_keys=True)}")


if __name__ == "__main__":
    main()
