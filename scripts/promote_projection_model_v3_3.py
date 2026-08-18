#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from import_player_projections import SupabaseRest, build_rows, load_local_environment
from projection_pipeline.scoring import score_projected_stats_exact
from projection_pipeline.v3_2_config import V3_2_ARTIFACT_DIR
from projection_pipeline.v3_3_config import (
    SCORING_TOLERANCE,
    V3_3_ARTIFACT_DIR,
    V3_3_FEATURE_VERSION,
    V3_3_PROJECTION_OUTPUT_PATH,
)

VERSION = "v3.3"
EXPECTED_SEASON = 2026
EXPECTED_WEEK = 1


def paged(client: SupabaseRest, path: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    separator = "&" if "?" in path else "?"
    while True:
        page = client.request("GET", f"{path}{separator}limit=1000&offset={offset}") or []
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += len(page)


def projection_count(client: SupabaseRest, model_id: str, final_only: bool = False) -> int:
    suffix = "&final_projection_ppr=not.is.null" if final_only else ""
    return len(paged(
        client,
        "player_projections?select=id"
        f"&model_version_id=eq.{model_id}&season=eq.{EXPECTED_SEASON}"
        f"&week=eq.{EXPECTED_WEEK}&season_type=eq.REG{suffix}",
    ))


def metadata_payload(v33: dict, v32: dict) -> dict:
    return {
        "version": VERSION,
        "algorithm": "regularized position-specific XGBoost components with v3.3 correction layer",
        "training_start_season": 2018,
        "training_end_season": 2025,
        "features": {
            "feature_version": V3_3_FEATURE_VERSION,
            "selected_snap_features": v32["selected_snap_features"],
            "architecture": v33["architecture"],
            "ensemble": v32["selected_candidate"],
            "hyperparameters": v32["hyperparameters"],
            "random_seed": v32["random_seed"],
        },
        "metrics": {
            "rolling_validation": v33["overall"]["v3_3"],
            "v3_2_baseline": v33["overall"]["v3_2"],
            "folds": v33["folds"],
            "positions": v33["positions"],
            "mandatory_gates": v33["mandatory_gates"],
            "current_sanity": v33.get("current_sanity"),
        },
    }


def validate_local(frame: pd.DataFrame, player_ids: dict[str, str], model_version_id: str) -> tuple[list[dict], dict]:
    required = {
        "gsis_id", "season", "week", "season_type", "projected_stats",
        "model_projection_ppr", "projected_points_standard",
        "projected_points_half_ppr", "projected_points_ppr", "floor_ppr",
        "median_ppr", "ceiling_ppr", "residual_low", "residual_high",
        "confidence", "drivers", "model_version",
    }
    missing_columns = sorted(required - set(frame.columns))
    duplicate_mask = frame.duplicated(["gsis_id", "season", "week", "season_type"], keep=False)
    missing_players = sorted(set(frame.loc[~frame.gsis_id.isin(player_ids), "gsis_id"].astype(str)))
    context_invalid = frame.loc[
        frame.season.ne(EXPECTED_SEASON)
        | frame.week.ne(EXPECTED_WEEK)
        | frame.season_type.ne("REG")
        | frame.model_version.ne(VERSION)
    ]
    component_failures: list[str] = []
    invalid_json: list[str] = []
    for record in frame.to_dict("records"):
        try:
            stats = json.loads(str(record["projected_stats"]))
            score = score_projected_stats_exact(stats, {"rec": 1.0}, str(record["position"]))
            if abs(score - float(record["model_projection_ppr"])) > SCORING_TOLERANCE:
                component_failures.append(str(record["gsis_id"]))
            drivers = json.loads(str(record["drivers"]))
            if not isinstance(drivers, list):
                invalid_json.append(str(record["gsis_id"]))
        except (ValueError, TypeError, json.JSONDecodeError):
            invalid_json.append(str(record.get("gsis_id")))
    invalid_count = (
        len(missing_columns) + int(duplicate_mask.sum()) + len(missing_players)
        + len(context_invalid) + len(component_failures) + len(invalid_json)
    )
    report = {
        "generated_rows": int(len(frame)),
        "valid_rows": int(len(frame)) if invalid_count == 0 else int(max(0, len(frame) - len(context_invalid) - len(missing_players) - len(component_failures) - len(invalid_json))),
        "invalid_rows": invalid_count,
        "duplicate_ids": int(duplicate_mask.sum()),
        "missing_player_ids": len(missing_players),
        "wrong_model_or_context_ids": int(len(context_invalid)),
        "component_ppr_failures": len(component_failures),
        "missing_columns": missing_columns,
    }
    if invalid_count:
        return [], report
    rows = build_rows(frame, player_ids, model_version_id)
    for row, record in zip(rows, frame.to_dict("records"), strict=True):
        row["raw_projected_stats"] = row["projected_stats"]
        row["generated_at"] = record.get("generated_at") or None
        if row["generated_at"] is None:
            row.pop("generated_at")
    return rows, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Preflight and atomically import frozen v3.3 projections.")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--input", type=Path, default=V3_3_PROJECTION_OUTPUT_PATH)
    args = parser.parse_args()
    load_local_environment()
    client = SupabaseRest()
    frame = pd.read_csv(args.input, dtype={"gsis_id": "string"})
    v33 = json.loads((V3_3_ARTIFACT_DIR / "manifest.json").read_text())
    v32 = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())

    versions = paged(client, "model_versions?select=id,version,algorithm,training_start_season,training_end_season,features,metrics,created_at&order=created_at.asc")
    version_by_name = {row["version"]: row for row in versions}
    remote_v33 = version_by_name.get(VERSION)
    remote_v2 = version_by_name.get("v2")
    print("Remote model versions:")
    for row in versions:
        print(f"  {row['version']}: {row['id']} ({row['training_start_season']}-{row['training_end_season']})")
    print(f"v3.3 metadata exists: {'YES' if remote_v33 else 'NO'}")
    print(f"v2 2026 Week 1 rows: {projection_count(client, remote_v2['id']) if remote_v2 else 0}")
    print(f"v2 reconciled rows: {projection_count(client, remote_v2['id'], True) if remote_v2 else 0}")
    print(f"existing v3.3 rows: {projection_count(client, remote_v33['id']) if remote_v33 else 0}")

    players = paged(client, "players?select=id,gsis_id&gsis_id=not.is.null")
    player_ids = {str(row["gsis_id"]): str(row["id"]) for row in players}
    planned_model_id = str(remote_v33["id"]) if remote_v33 else "00000000-0000-0000-0000-000000000000"
    rows, preflight = validate_local(frame, player_ids, planned_model_id)
    print("Projection import preflight")
    print(f"Reconciled/generated rows: {preflight['generated_rows']}")
    print(f"Valid rows: {preflight['valid_rows']}")
    print(f"Invalid rows: {preflight['invalid_rows']}")
    print(f"Duplicate IDs: {preflight['duplicate_ids']}")
    print(f"Missing player IDs: {preflight['missing_player_ids']}")
    print(f"Wrong model/context IDs: {preflight['wrong_model_or_context_ids']}")
    print(f"Component/PPR failures: {preflight['component_ppr_failures']}")
    safe = preflight["invalid_rows"] == 0 and len(frame) == 613 and remote_v2 is not None
    print(f"Safe to apply: {'YES' if safe else 'NO'}")
    if not args.apply:
        print("Dry run: no remote writes performed.")
        return
    if not safe:
        raise RuntimeError("Refusing v3.3 import because production preflight failed.")

    if remote_v33 is None:
        created = client.request("POST", "model_versions", [metadata_payload(v33, v32)], "return=representation")
        remote_v33 = created[0]
        print(f"Created v3.3 model metadata: {remote_v33['id']}")
    rows, preflight = validate_local(frame, player_ids, str(remote_v33["id"]))
    # One PostgREST upsert is one database statement: either all 613 projection
    # rows succeed or none are committed.
    client.request(
        "POST",
        "player_projections?on_conflict=player_id,season,week,season_type,model_version_id",
        rows,
        "resolution=merge-duplicates,return=minimal",
    )
    remote_count = projection_count(client, str(remote_v33["id"]))
    if remote_count != len(rows):
        raise RuntimeError(f"Post-import count mismatch: expected {len(rows)}, found {remote_count}")
    print(f"Atomically imported {remote_count} v3.3 projections; v2 remained untouched.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f"v3.3 promotion import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
