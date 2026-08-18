#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

if __package__:
    from .projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_PROJECTION_OUTPUT_PATH
else:
    from projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_PROJECTION_OUTPUT_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a local current-player v2/v3 sanity report.")
    parser.add_argument("--v2", type=Path, default=Path("data/processed/player_projections_v2.csv"))
    parser.add_argument("--v3", type=Path, default=V3_PROJECTION_OUTPUT_PATH)
    parser.add_argument("--output", type=Path, default=Path("data/processed/model_v3_current_sanity.csv"))
    args = parser.parse_args()
    v2 = pd.read_csv(args.v2, dtype={"gsis_id": "string"})[[
        "gsis_id", "model_projection_ppr", "floor_ppr", "ceiling_ppr", "confidence",
    ]].rename(columns={
        "model_projection_ppr": "v2_ppr", "floor_ppr": "v2_floor",
        "ceiling_ppr": "v2_ceiling", "confidence": "v2_confidence",
    })
    v3 = pd.read_csv(args.v3, dtype={"gsis_id": "string"}).rename(columns={
        "model_projection_ppr": "v3_ppr", "floor_ppr": "v3_floor",
        "ceiling_ppr": "v3_ceiling", "confidence": "v3_confidence",
    })
    report = v3.merge(v2, on="gsis_id", how="left", validate="one_to_one")
    identity = pd.read_csv(
        "data/processed/player_identity.csv",
        usecols=["player_id", "player_name", "rookie_season"],
        dtype={"player_id": "string"},
    ).rename(columns={"player_id": "gsis_id"})
    report = report.merge(identity.drop_duplicates("gsis_id"), on="gsis_id", how="left")
    depth_path = Path("data/processed/depth_chart_roles.csv")
    if depth_path.exists():
        depth = pd.read_csv(depth_path, dtype={"gsis_id": "string"})
        latest = depth.sort_values(["season", "source_updated_at"]).groupby("gsis_id", as_index=False).tail(1)
        report = report.merge(
            latest[["gsis_id", "depth_position", "depth_rank", "is_starter"]],
            on="gsis_id", how="left", validate="one_to_one",
        )
    advanced = pd.read_csv(
        PBP_WEEKLY_PATH,
        usecols=["player_id", "season", "week", "goal_line_carries", "red_zone_targets"],
        dtype={"player_id": "string"},
    )
    recent = advanced.sort_values(["season", "week"]).groupby("player_id", as_index=False).tail(3)
    recent = recent.groupby("player_id", as_index=False).agg(
        recent_goal_line_carries=("goal_line_carries", "mean"),
        recent_red_zone_targets=("red_zone_targets", "mean"),
    ).rename(columns={"player_id": "gsis_id"})
    report = report.merge(recent, on="gsis_id", how="left", validate="one_to_one")
    report["difference"] = report["v3_ppr"] - report["v2_ppr"]
    position_rank = report.groupby("position")["v2_ppr"].rank(method="first", ascending=False)
    labels: list[str] = []
    for index, row in report.iterrows():
        kinds: list[str] = []
        if position_rank.loc[index] <= 12 and bool(row.get("is_starter", False)):
            kinds.append("elite_starter")
        if row["position"] == "RB" and row.get("depth_rank") == 2:
            kinds.append("committee_rb")
        if row.get("rookie_season") == row["season"]:
            kinds.append("rookie")
        if row["position"] == "QB" and row.get("depth_rank", 1) > 1:
            kinds.append("backup_qb")
        if row.get("depth_rank", 0) >= 3:
            kinds.append("low_depth")
        if row.get("recent_goal_line_carries", 0) >= 1 or row.get("recent_red_zone_targets", 0) >= 1.5:
            kinds.append("high_red_zone_role")
        labels.append(";".join(kinds) or "other")
    report["archetypes"] = labels
    columns = [
        "player_name", "gsis_id", "position", "team", "opponent_team",
        "depth_position", "depth_rank", "archetypes", "v2_ppr", "v3_ppr", "difference",
        "v2_floor", "v3_floor", "v2_ceiling", "v3_ceiling", "v3_confidence",
        "recent_goal_line_carries", "recent_red_zone_targets",
    ]
    for column in columns:
        if column not in report:
            report[column] = pd.NA
    report[columns].sort_values("difference", key=lambda values: values.abs(), ascending=False).to_csv(
        args.output, index=False
    )
    print("Largest absolute v3 changes:")
    print(report[columns].sort_values("difference", key=lambda values: values.abs(), ascending=False).head(20).to_string(index=False))
    print(f"Full sanity report: {args.output}")


if __name__ == "__main__":
    main()
