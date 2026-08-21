#!/usr/bin/env python3
"""Preflight and atomically import the frozen v4.1 raw projections."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from import_player_projections import SupabaseRest, load_local_environment
from promote_projection_model_v3_3 import paged, projection_count, validate_local

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data/processed/player_projections_v4_1_release.csv"
MANIFEST = ROOT / "artifacts/projections/v4_1/manifest.json"
VERSION = "v4.1"


def main() -> None:
    parser = argparse.ArgumentParser(description="Preflight and atomically import v4.1 projections.")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    load_local_environment()
    client = SupabaseRest()
    frame = pd.read_csv(INPUT, dtype={"gsis_id": "string"})
    manifest = json.loads(MANIFEST.read_text())
    versions = paged(client, "model_versions?select=id,version,algorithm,training_start_season,training_end_season,features,metrics,created_at&order=created_at.asc")
    by_version = {row["version"]: row for row in versions}
    current = by_version.get(VERSION)
    rollback = by_version.get("v3.3.2")
    players = paged(client, "players?select=id,gsis_id&gsis_id=not.is.null")
    player_ids = {str(row["gsis_id"]): str(row["id"]) for row in players}
    planned_id = str(current["id"]) if current else "00000000-0000-0000-0000-000000000000"
    rows, preflight = validate_local(frame, player_ids, planned_id, VERSION)
    safe = (
        preflight["invalid_rows"] == 0
        and len(frame) == 613
        and rollback is not None
        and projection_count(client, str(rollback["id"])) == 613
    )
    print("v4.1 production import preflight")
    print(f"Remote model versions: {', '.join(sorted(by_version))}")
    print(f"v4.1 metadata exists: {'YES' if current else 'NO'}")
    print(f"v3.3.2 rollback rows: {projection_count(client, str(rollback['id'])) if rollback else 0}")
    for key, value in preflight.items():
        print(f"{key}: {value}")
    print(f"Artifact SHA-256: {manifest['projection_sha256']}")
    print(f"Safe to apply: {'YES' if safe else 'NO'}")
    if not args.apply:
        print("Dry run: no remote writes performed.")
        return
    if not safe:
        raise RuntimeError("Refusing v4.1 import because the production preflight failed.")
    if current is None:
        payload = {
            "version": VERSION,
            "algorithm": manifest["algorithm"],
            "training_start_season": manifest["training_range"][0],
            "training_end_season": manifest["training_range"][1],
            "features": {
                **manifest["features"],
                "feature_version": manifest["feature_version"],
                "projection_sha256": manifest["projection_sha256"],
                "random_seed": manifest["random_seed"],
            },
            "metrics": manifest["evaluation"],
        }
        current = client.request("POST", "model_versions", [payload], "return=representation")[0]
        print(f"Created v4.1 metadata: {current['id']}")
    rows, preflight = validate_local(frame, player_ids, str(current["id"]), VERSION)
    if preflight["invalid_rows"]:
        raise RuntimeError("v4.1 payload changed after model-version creation.")
    client.request(
        "POST",
        "player_projections?on_conflict=player_id,season,week,season_type,model_version_id",
        rows,
        "resolution=merge-duplicates,return=minimal",
    )
    written = projection_count(client, str(current["id"]))
    rollback_rows = projection_count(client, str(rollback["id"]))
    if written != 613 or rollback_rows != 613:
        raise RuntimeError(f"Post-import readback failed: v4.1={written}, v3.3.2={rollback_rows}")
    print(f"Atomically imported {written} v4.1 raw rows; preserved {rollback_rows} v3.3.2 rollback rows.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f"v4.1 promotion import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
