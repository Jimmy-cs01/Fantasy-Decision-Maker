#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import quote

import pandas as pd

from import_player_projections import SupabaseRest, chunks, load_local_environment

REQUIRED = {
    "gsis_id", "season", "team", "position", "depth_position", "depth_rank",
    "is_starter", "provider", "source_updated_at", "fetched_at",
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Map normalized depth charts to canonical players and import snapshots.")
    parser.add_argument("--input", type=Path, default=Path("data/processed/depth_chart_roles.csv"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    frame = pd.read_csv(args.input, dtype={"gsis_id": "string"})
    missing = REQUIRED.difference(frame.columns)
    if missing:
        raise ValueError(f"Depth chart export is missing columns: {sorted(missing)}")
    if frame.duplicated(["gsis_id", "provider", "source_updated_at"]).any():
        raise ValueError("Depth chart export contains duplicate player snapshots")
    if args.dry_run:
        print(f"Validated {len(frame):,} depth-chart rows; no remote writes performed.")
        return

    load_local_environment()
    client = SupabaseRest()
    gsis_ids = frame["gsis_id"].dropna().astype(str).unique().tolist()
    player_ids: dict[str, str] = {}
    for batch in chunks(gsis_ids, 150):
        values = ",".join(batch)
        rows = client.request("GET", "players?select=id,gsis_id&gsis_id=in.(" + quote(values, safe=",-.()") + ")")
        player_ids.update({row["gsis_id"]: row["id"] for row in rows})
    records = []
    for row in frame.to_dict("records"):
        player_id = player_ids.get(str(row["gsis_id"]))
        if not player_id:
            continue
        records.append({
            "player_id": player_id,
            "provider": str(row["provider"]),
            "season": int(row["season"]),
            "team": str(row["team"]),
            "position": str(row["position"]),
            "depth_position": str(row["depth_position"]),
            "depth_rank": int(row["depth_rank"]),
            "is_starter": bool(row["is_starter"]),
            "source_updated_at": pd.Timestamp(row["source_updated_at"]).isoformat(),
            "fetched_at": pd.Timestamp(row["fetched_at"]).isoformat(),
        })
    for number, batch in enumerate(chunks(records), start=1):
        client.request(
            "POST",
            "player_depth_chart_roles?on_conflict=player_id,provider,source_updated_at",
            batch,
            "resolution=merge-duplicates,return=minimal",
        )
        print(f"Depth-chart batch {number} upserted ({len(batch)} rows)")
    print(f"Imported {len(records):,} roles; {len(frame) - len(records):,} rows lacked a canonical GSIS match.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Depth-chart import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
