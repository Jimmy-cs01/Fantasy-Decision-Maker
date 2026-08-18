#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

if __package__:
    from .projection_pipeline.config import ARTIFACT_ROOT
    from .projection_pipeline.v3_config import V3_COMPARISON_PATH
else:
    from projection_pipeline.config import ARTIFACT_ROOT
    from projection_pipeline.v3_config import V3_COMPARISON_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare v2 and experimental v3 on held-out 2025 weeks.")
    parser.add_argument("--version", default="v3")
    parser.add_argument("--output", type=Path, default=V3_COMPARISON_PATH)
    args = parser.parse_args()
    artifact = ARTIFACT_ROOT / args.version
    manifest = json.loads((artifact / "manifest.json").read_text())
    predictions = pd.read_csv(artifact / "heldout_predictions.csv.gz", dtype={"player_id": "string"})
    predictions = predictions.rename(columns={
        "fantasy_points_ppr": "actual_ppr", "_v2": "v2", "_v3": "v3",
    })
    predictions["v3_difference"] = predictions["v3"] - predictions["v2"]
    predictions["v2_absolute_error"] = (predictions["v2"] - predictions["actual_ppr"]).abs()
    predictions["v3_absolute_error"] = (predictions["v3"] - predictions["actual_ppr"]).abs()
    identity_path = Path("data/processed/player_identity.csv")
    if identity_path.exists():
        identity = pd.read_csv(identity_path, usecols=["player_id", "player_name"], dtype={"player_id": "string"})
        predictions = predictions.merge(identity.drop_duplicates("player_id"), on="player_id", how="left")
        leading = ["player_name", "player_id", "historical_position", "season", "week"]
        predictions = predictions[leading + [column for column in predictions if column not in leading]]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    predictions.to_csv(args.output, index=False)
    print(json.dumps(manifest["evaluation"], indent=2))
    print(f"Side-by-side held-out rows: {args.output}")


if __name__ == "__main__":
    main()
