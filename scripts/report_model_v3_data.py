#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

if __package__:
    from .projection_pipeline.v3_config import V3_DATA_REPORT_PATH, V3_FEATURE_REPORT_PATH
else:
    from projection_pipeline.v3_config import V3_DATA_REPORT_PATH, V3_FEATURE_REPORT_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description="Print Model v3 dataset and feature-health reports.")
    parser.add_argument("--report", type=Path, default=V3_DATA_REPORT_PATH)
    parser.add_argument("--feature-report", type=Path, default=V3_FEATURE_REPORT_PATH)
    args = parser.parse_args()
    print(json.dumps(json.loads(args.report.read_text()), indent=2))
    print(f"Detailed feature audit: {args.feature_report}")


if __name__ == "__main__":
    main()
