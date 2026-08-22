#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
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
MAX_REQUEST_ATTEMPTS = 6
RETRYABLE_HTTP_STATUSES = {408, 425, 429, 500, 502, 503, 504}


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
        encoded = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
        endpoint = path.split("?", 1)[0]
        for attempt in range(1, MAX_REQUEST_ATTEMPTS + 1):
            request = urllib.request.Request(
                f"{self.url}/rest/v1/{path}",
                data=encoded,
                headers={**headers, "Accept": "application/json"},
                method=method,
            )
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    body = response.read()
                if not body:
                    return None
                try:
                    return json.loads(body)
                except (json.JSONDecodeError, UnicodeDecodeError) as error:
                    if attempt == MAX_REQUEST_ATTEMPTS:
                        raise RuntimeError(
                            f"Supabase {method} {endpoint} returned an incomplete JSON response "
                            f"after {MAX_REQUEST_ATTEMPTS} attempts."
                        ) from error
                    delay = min(2 ** (attempt - 1), 16)
                    print(
                        f"Incomplete Supabase response during {method} {endpoint}; "
                        f"retrying in {delay}s ({attempt}/{MAX_REQUEST_ATTEMPTS})..."
                    )
                    time.sleep(delay)
            except urllib.error.HTTPError as error:
                detail = error.read().decode(errors="replace")
                if error.code not in RETRYABLE_HTTP_STATUSES or attempt == MAX_REQUEST_ATTEMPTS:
                    raise RuntimeError(
                        f"Supabase {method} {endpoint} failed ({error.code}): {detail}"
                    ) from error
                retry_after = error.headers.get("Retry-After") if error.headers else None
                delay = float(retry_after) if retry_after and retry_after.isdigit() else min(2 ** (attempt - 1), 16)
                print(
                    f"Transient Supabase {error.code} during {method} {endpoint}; "
                    f"retrying in {delay:g}s ({attempt}/{MAX_REQUEST_ATTEMPTS})..."
                )
                time.sleep(delay)
            except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
                if attempt == MAX_REQUEST_ATTEMPTS:
                    raise RuntimeError(
                        f"Supabase {method} {endpoint} failed after "
                        f"{MAX_REQUEST_ATTEMPTS} attempts: {error}"
                    ) from error
                delay = min(2 ** (attempt - 1), 16)
                print(
                    f"Transient connection failure during {method} {endpoint}: {error}; "
                    f"retrying in {delay}s ({attempt}/{MAX_REQUEST_ATTEMPTS})..."
                )
                time.sleep(delay)
        raise AssertionError("Supabase request retry loop exited unexpectedly.")


def chunks(rows: list[dict], size: int = 500):
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


def parse_json_cell(value: object, field: str, row_number: int, gsis_id: str):
    try:
        return json.loads(str(value))
    except (json.JSONDecodeError, TypeError) as error:
        raise ValueError(
            f"Invalid {field} JSON at CSV row {row_number} for GSIS ID {gsis_id}: {error}"
        ) from error


def validate_export_json(frame: pd.DataFrame) -> None:
    for index, record in enumerate(frame.to_dict("records"), start=2):
        gsis_id = str(record["gsis_id"])
        parse_json_cell(record["projected_stats"], "projected_stats", index, gsis_id)
        drivers = parse_json_cell(record["drivers"], "drivers", index, gsis_id)
        if not isinstance(drivers, list) or not all(isinstance(driver, str) for driver in drivers):
            raise ValueError(
                f"drivers must be a JSON string array at CSV row {index} for GSIS ID {gsis_id}"
            )


def manifest_path_for_version(version: str) -> Path:
    """Resolve display versions (v4.1) to the repository's artifact convention (v4_1)."""
    exact = ARTIFACT_ROOT / version / "manifest.json"
    if exact.exists():
        return exact
    normalized = ARTIFACT_ROOT / version.replace(".", "_") / "manifest.json"
    return normalized


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
            "projected_stats": parse_json_cell(record["projected_stats"], "projected_stats", len(rows) + 2, gsis_id),
            "model_projection_ppr": float(record["model_projection_ppr"]),
            "projected_points_standard": float(record["projected_points_standard"]),
            "projected_points_half_ppr": float(record["projected_points_half_ppr"]),
            "projected_points_ppr": float(record["projected_points_ppr"]),
            "floor_ppr": float(record["floor_ppr"]), "median_ppr": float(record["median_ppr"]),
            "ceiling_ppr": float(record["ceiling_ppr"]), "residual_low": float(record["residual_low"]),
            "residual_high": float(record["residual_high"]), "confidence": record["confidence"],
            "drivers": parse_json_cell(record["drivers"], "drivers", len(rows) + 2, gsis_id),
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Upsert generated player projections into Supabase.")
    parser.add_argument("--input", type=Path, default=PROJECTION_OUTPUT_PATH)
    parser.add_argument("--version", default="v1")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    frame = pd.read_csv(args.input, dtype={"gsis_id": "string"})
    manifest = json.loads(manifest_path_for_version(args.version).read_text())
    exported_versions = set(frame.get("model_version", pd.Series(dtype="string")).dropna().astype(str))
    if exported_versions and exported_versions != {args.version}:
        raise ValueError(f"Projection export model versions {sorted(exported_versions)} do not match {args.version}")
    if frame.duplicated(["gsis_id", "season", "week", "season_type"]).any():
        raise ValueError("Projection export contains duplicate player-week rows")
    validate_export_json(frame)
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
