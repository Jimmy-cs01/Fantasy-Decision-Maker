#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

if __package__:
    from .projection_pipeline.config import HISTORICAL_STATS_PATH, SCHEDULE_OUTPUT_PATH
    from .projection_pipeline.features import read_historical_stats
    from .projection_pipeline.schedules import read_normalized_schedule
    from .projection_pipeline.v3_config import (
        PBP_FEATURE_VERSION, PBP_WEEKLY_PATH, V3_DATA_REPORT_PATH,
        V3_FEATURE_DATASET_PATH, V3_FEATURE_REPORT_PATH,
    )
    from .projection_pipeline.v3_features import (
        build_v3_modeling_dataset, feature_audit, read_advanced_weekly, validate_v3_dataset,
    )
else:
    from projection_pipeline.config import HISTORICAL_STATS_PATH, SCHEDULE_OUTPUT_PATH
    from projection_pipeline.features import read_historical_stats
    from projection_pipeline.schedules import read_normalized_schedule
    from projection_pipeline.v3_config import (
        PBP_FEATURE_VERSION, PBP_WEEKLY_PATH, V3_DATA_REPORT_PATH,
        V3_FEATURE_DATASET_PATH, V3_FEATURE_REPORT_PATH,
    )
    from projection_pipeline.v3_features import (
        build_v3_modeling_dataset, feature_audit, read_advanced_weekly, validate_v3_dataset,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build leakage-safe Model v3 player-week features.")
    parser.add_argument("--historical", type=Path, default=HISTORICAL_STATS_PATH)
    parser.add_argument("--advanced", type=Path, default=PBP_WEEKLY_PATH)
    parser.add_argument("--schedule", type=Path, default=SCHEDULE_OUTPUT_PATH)
    parser.add_argument("--output", type=Path, default=V3_FEATURE_DATASET_PATH)
    parser.add_argument("--report", type=Path, default=V3_DATA_REPORT_PATH)
    parser.add_argument("--feature-report", type=Path, default=V3_FEATURE_REPORT_PATH)
    args = parser.parse_args()

    historical = read_historical_stats(args.historical)
    advanced = read_advanced_weekly(args.advanced)
    frame = build_v3_modeling_dataset(historical, advanced, read_normalized_schedule(args.schedule))
    frame = frame.loc[frame["season"].between(2018, 2025)].copy()
    validate_v3_dataset(frame)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(args.output, index=False, compression="gzip")

    audit = feature_audit(frame)
    audit.to_csv(args.feature_report, index=False)
    advanced_columns = [column for column in frame if column.endswith(("_l3", "_l5", "_l8"))]
    report = {
        "feature_version": PBP_FEATURE_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "seasons": [int(frame["season"].min()), int(frame["season"].max())],
        "player_weeks": len(frame),
        "rows_by_position": frame.groupby("historical_position").size().astype(int).to_dict(),
        "feature_count_union": len(set(audit["name"])),
        "rolling_advanced_feature_count": len(advanced_columns),
        "target_coverage": round(float(frame["fantasy_points_ppr"].notna().mean()), 6),
        "features_over_50_percent_missing": int(audit["flag_high_missing"].sum()),
        "near_zero_variance_features": int(audit["flag_near_zero_variance"].sum()),
        "leakage_risk_features": audit.loc[audit["leakage_risk"], "name"].drop_duplicates().tolist(),
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    print(f"Features: {args.output}")
    print(f"Feature audit: {args.feature_report}")


if __name__ == "__main__":
    main()
