#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

if __package__:
    from .projection_pipeline.config import ARTIFACT_ROOT, PROJECTION_OUTPUT_PATH
else:
    from projection_pipeline.config import ARTIFACT_ROOT, PROJECTION_OUTPUT_PATH

ENV_FILES = (Path(".env.local"), Path(".env"))


def load_local_environment() -> None:
    """Load local server credentials without overriding exported variables."""
    for path in ENV_FILES:
        if not path.exists():
            continue
        for raw_line in path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def env_value(name: str) -> str:
    value = os.getenv(name)
    if name == "NEXT_PUBLIC_SUPABASE_URL":
        value = value or os.getenv("SUPABASE_URL")
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value.rstrip("/")


class SupabaseRest:
    def __init__(self) -> None:
        self.url = env_value("NEXT_PUBLIC_SUPABASE_URL")
        self.key = env_value("SUPABASE_SERVICE_ROLE_KEY")

    def request(self, method: str, path: str, payload: object | None = None, prefer: str | None = None):
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        request = urllib.request.Request(
            f"{self.url}/rest/v1/{path}",
            data=json.dumps(payload).encode() if payload is not None else None,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"Supabase request failed ({error.code}): {error.read().decode()}") from error


def chunks(rows: list[dict], size: int = 500):
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


def build_rows(frame: pd.DataFrame, player_ids: dict[str, str], model_version_id: str) -> list[dict]:
    rows = []
    for record in frame.to_dict("records"):
        gsis_id = str(record["gsis_id"])
        if gsis_id not in player_ids:
            raise ValueError(f"No database player found for GSIS ID {gsis_id}")
        nullable = lambda value: None if pd.isna(value) else value
        rows.append({
            "player_id": player_ids[gsis_id], "model_version_id": model_version_id,
            "season": int(record["season"]), "week": int(record["week"]), "season_type": record["season_type"],
            "team": nullable(record["team"]), "opponent_team": nullable(record["opponent_team"]),
            "projected_stats": json.loads(record["projected_stats"]),
            "model_projection_ppr": float(record["model_projection_ppr"]),
            "projected_points_standard": float(record["projected_points_standard"]),
            "projected_points_half_ppr": float(record["projected_points_half_ppr"]),
            "projected_points_ppr": float(record["projected_points_ppr"]),
            "floor_ppr": float(record["floor_ppr"]), "median_ppr": float(record["median_ppr"]),
            "ceiling_ppr": float(record["ceiling_ppr"]), "residual_low": float(record["residual_low"]),
            "residual_high": float(record["residual_high"]), "confidence": record["confidence"],
            "drivers": json.loads(record["drivers"]),
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Upsert generated player projections into Supabase.")
    parser.add_argument("--input", type=Path, default=PROJECTION_OUTPUT_PATH)
    parser.add_argument("--version", default="v1")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    frame = pd.read_csv(args.input, dtype={"gsis_id": "string"})
    manifest = json.loads((ARTIFACT_ROOT / args.version / "manifest.json").read_text())
    exported_versions = set(frame.get("model_version", pd.Series(dtype="string")).dropna().astype(str))
    if exported_versions and exported_versions != {args.version}:
        raise ValueError(f"Projection export model versions {sorted(exported_versions)} do not match {args.version}")
    if frame.duplicated(["gsis_id", "season", "week", "season_type"]).any():
        raise ValueError("Projection export contains duplicate player-week rows")
    if args.dry_run:
        print(f"Validated {len(frame):,} projection rows for model {args.version}; no remote writes performed.")
        return

    load_local_environment()
    client = SupabaseRest()
    version_payload = {
        "version": args.version, "algorithm": manifest["algorithm"],
        "training_start_season": manifest["training_range"][0],
        "training_end_season": manifest["training_range"][1],
        "features": manifest["features"], "metrics": manifest["evaluation"],
    }
    versions = client.request("POST", "model_versions?on_conflict=version", [version_payload], "resolution=merge-duplicates,return=representation")
    model_version_id = versions[0]["id"]
    players = []
    offset = 0
    while True:
        page = client.request("GET", f"players?select=id,gsis_id&gsis_id=not.is.null&limit=1000&offset={offset}")
        players.extend(page)
        if len(page) < 1000:
            break
        offset += len(page)
    player_ids = {row["gsis_id"]: row["id"] for row in players}
    rows = build_rows(frame, player_ids, model_version_id)
    for batch_number, batch in enumerate(chunks(rows), start=1):
        client.request("POST", "player_projections?on_conflict=player_id,season,week,season_type,model_version_id", batch, "resolution=merge-duplicates,return=minimal")
        print(f"Projection batch {batch_number} upserted ({len(batch)} rows)")
    print(f"Imported {len(rows):,} projections for model {args.version}.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Projection import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
