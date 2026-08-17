#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

OUTPUT = Path("data/processed/depth_chart_roles.csv")
REQUIRED = ["dt", "team", "player_name", "gsis_id", "pos_grp", "pos_abb", "pos_rank"]


def normalize_depth_chart(frame: pd.DataFrame, season: int, fetched_at: str | None = None) -> pd.DataFrame:
    frame = frame.copy()
    frame["dt"] = pd.to_datetime(frame["dt"], utc=True, errors="coerce")
    latest = frame["dt"].max()
    frame = frame.loc[
        frame["dt"].eq(latest)
        & frame["pos_abb"].isin(["QB", "RB", "WR", "TE"])
        & frame["gsis_id"].notna()
    ].copy()
    frame["season"] = season
    frame["provider"] = "nflverse/ESPN"
    frame["position"] = frame["pos_abb"]
    frame["depth_position"] = frame["pos_abb"]
    frame["depth_rank"] = pd.to_numeric(frame["pos_rank"], errors="raise").astype("int64")
    frame["is_starter"] = frame["depth_rank"].eq(1)
    frame["fetched_at"] = fetched_at or datetime.now(timezone.utc).isoformat()
    output = frame.rename(columns={"dt": "source_updated_at"})[
        ["gsis_id", "player_name", "season", "team", "position", "depth_position", "depth_rank", "is_starter", "provider", "source_updated_at", "fetched_at"]
    ].sort_values(["team", "position", "depth_rank", "player_name"])
    if output.duplicated(["gsis_id"]).any():
        duplicated = output.loc[output.duplicated(["gsis_id"], keep=False), "gsis_id"].tolist()
        raise ValueError(f"Latest depth chart contains duplicate GSIS identities: {duplicated[:10]}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Download the latest nflverse/ESPN depth chart snapshot.")
    parser.add_argument("--season", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    url = f"https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_{args.season}.csv"
    frame = pd.read_csv(url, usecols=REQUIRED, dtype={"gsis_id": "string"})
    output = normalize_depth_chart(frame, args.season)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False)
    latest = pd.Timestamp(output["source_updated_at"].max()) if len(output) else None
    print(f"Wrote {len(output):,} mapped depth-chart candidates for {args.season} ({latest.isoformat() if latest else 'no snapshot'}).")
    print(f"Output: {args.output.resolve()}")


if __name__ == "__main__":
    main()
