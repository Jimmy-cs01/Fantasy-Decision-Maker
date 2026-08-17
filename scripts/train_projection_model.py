#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

if __package__:
    from .projection_pipeline.config import ARTIFACT_ROOT, FEATURE_DATASET_PATH
    from .projection_pipeline.model import train_bundle
else:
    from projection_pipeline.config import ARTIFACT_ROOT, FEATURE_DATASET_PATH
    from projection_pipeline.model import train_bundle


def main() -> None:
    parser = argparse.ArgumentParser(description="Train chronological XGBoost player projection models.")
    parser.add_argument("--features", default=str(FEATURE_DATASET_PATH))
    parser.add_argument("--version", default="v1")
    args = parser.parse_args()
    features = pd.read_csv(args.features, dtype={"player_id": "string"})
    output = ARTIFACT_ROOT / args.version
    manifest = train_bundle(features, output, args.version)
    print(f"Trained projection model {args.version} in {output}")
    print("Test metrics (2024–2025):")
    for name, metrics in manifest["evaluation"]["overall"].items():
        print(f"  {name:10} MAE {metrics['mae']:.3f} | RMSE {metrics['rmse']:.3f} | r {metrics['correlation']:.3f}")
    print("By position:")
    for position, metrics in manifest["evaluation"]["by_position"].items():
        print(f"  {position}: MAE {metrics['mae']:.3f} | RMSE {metrics['rmse']:.3f} | r {metrics['correlation']:.3f}")
    print("Weeks 1–4:")
    for name, metrics in manifest["evaluation"]["weeks_1_4"].items():
        print(f"  {name:10} MAE {metrics['mae']:.3f} | RMSE {metrics['rmse']:.3f} | r {metrics['correlation']:.3f}")


if __name__ == "__main__":
    main()
