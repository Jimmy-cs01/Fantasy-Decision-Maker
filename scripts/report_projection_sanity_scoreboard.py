#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from projection_pipeline.sanity_scoreboard import current_projection_sanity


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data/processed/model_v3_3_comparison.csv"
DEFAULT_OUTPUT = ROOT / "data/processed/projection_sanity_scoreboard.json"


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit current projections for football and component sanity.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--prediction", default="model_projection_ppr")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    frame = pd.read_csv(args.input, dtype={"gsis_id": "string", "player_id": "string"})
    report = current_projection_sanity(frame, args.prediction)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Projection sanity scoreboard: {args.output}")
    for name, detail in report["violations"].items():
        print(f"  {name}: {detail['count']}")
    print(f"  team target/QB-attempt warnings: {len(report['team_target_vs_qb_attempt_warnings'])}")
    print(f"  Safe to promote: {'YES' if report['promotion_safe'] else 'NO'}")
    print("No remote data or production settings were changed.")


if __name__ == "__main__":
    main()
