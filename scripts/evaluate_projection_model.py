#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json

if __package__:
    from .projection_pipeline.config import ARTIFACT_ROOT
else:
    from projection_pipeline.config import ARTIFACT_ROOT


def main() -> None:
    parser = argparse.ArgumentParser(description="Print saved chronological projection evaluation metrics.")
    parser.add_argument("--version", default="v1")
    args = parser.parse_args()
    manifest_path = ARTIFACT_ROOT / args.version / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    print(json.dumps(manifest["evaluation"], indent=2))


if __name__ == "__main__":
    main()
