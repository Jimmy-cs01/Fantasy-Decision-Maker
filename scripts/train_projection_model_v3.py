#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

if __package__:
    from .projection_pipeline.config import ARTIFACT_ROOT
    from .projection_pipeline.v3_config import V3_FEATURE_DATASET_PATH
    from .projection_pipeline.v3_model import train_v3_bundle
else:
    from projection_pipeline.config import ARTIFACT_ROOT
    from projection_pipeline.v3_config import V3_FEATURE_DATASET_PATH
    from projection_pipeline.v3_model import train_v3_bundle


def main() -> None:
    parser = argparse.ArgumentParser(description="Train experimental Model v3 without altering v2.")
    parser.add_argument("--features", type=Path, default=V3_FEATURE_DATASET_PATH)
    parser.add_argument("--version", default="v3")
    args = parser.parse_args()
    if args.version in {"v1", "v2"}:
        raise ValueError("Model v3 trainer refuses to overwrite v1/v2 artifacts")
    frame = pd.read_csv(args.features, dtype={"player_id": "string"})
    manifest = train_v3_bundle(frame, ARTIFACT_ROOT / args.version, args.version, ARTIFACT_ROOT / "v2")
    print(f"Trained experimental projection model {args.version} in {ARTIFACT_ROOT / args.version}")
    print("Held-out 2025 comparison:")
    for model, metrics in manifest["evaluation"]["overall"].items():
        print(
            f"  {model}: MAE {metrics['mae']:.3f} | RMSE {metrics['rmse']:.3f} | "
            f"R² {metrics['r2']:.3f} | r {metrics['correlation']:.3f}"
        )
    print("Model v3 remains experimental; no projection rows were written remotely.")


if __name__ == "__main__":
    main()
