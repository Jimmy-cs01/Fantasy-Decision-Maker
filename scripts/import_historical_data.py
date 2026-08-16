"""Idempotently import processed historical data through Supabase PostgREST.

Dry-run validates local data and performs no network calls. Live mode requires a
service-role key and upserts in batches; it never truncates or bulk-deletes data.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

IDENTITY_FILE = Path("data/processed/player_identity.csv")
WEEKLY_FILE = Path("data/processed/historical_weekly_player_stats.csv")
ENV_FILES = (Path(".env.local"), Path(".env"))
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE"}
EXPECTED_SEASONS = set(range(2012, 2026))
LOGICAL_WEEKLY_KEY = ["player_id", "season", "week", "season_type", "game_id"]
PLAYER_REQUIRED = {"player_id", "player_name", "historical_position", "sleeper_player_id"}
WEEKLY_REQUIRED = set(LOGICAL_WEEKLY_KEY + ["team", "fantasy_points_standard", "fantasy_points_half_ppr", "fantasy_points_ppr"])
WEEKLY_RENAMES = {
    "complete_pass": "completions", "comp_pct": "completion_percentage", "ypa": "yards_per_attempt",
    "pass_touchdown": "passing_touchdowns", "interception": "interceptions", "first_down_pass": "first_down_passes",
    "times_pressured_pct": "pressure_percentage", "yptarget": "yards_per_target", "ypr": "yards_per_reception",
    "rec_adot": "receiving_adot", "receiving_touchdown": "receiving_touchdowns",
    "rush_attempts_gtg": "rush_attempts_goal_to_go", "ypc": "yards_per_carry",
    "rush_touchdown": "rushing_touchdowns", "rush_touchdown_red_zone": "rushing_touchdowns_red_zone",
    "rush_touchdown_gtg": "rushing_touchdowns_goal_to_go", "offense_pct": "offense_snap_percentage",
    "total_tds": "total_touchdowns",
}
CONTEXT_COLUMNS = {"player_id", "sleeper_player_id", "season", "week", "season_type", "game_id", "team"}


def load_local_environment() -> None:
    for path in ENV_FILES:
        if not path.exists():
            continue
        for raw_line in path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def batched(items: list[dict[str, Any]], size: int) -> Iterable[tuple[int, list[dict[str, Any]]]]:
    for start in range(0, len(items), size):
        yield start // size + 1, items[start:start + size]


def clean(value: Any) -> Any:
    if value is None or pd.isna(value) or (isinstance(value, str) and not value.strip()):
        return None
    if hasattr(value, "item"):
        value = value.item()
    return value


def clean_integer(value: Any) -> int | None:
    value = clean(value)
    return None if value is None else int(round(float(value)))


def load_and_validate_inputs() -> tuple[pd.DataFrame, pd.DataFrame]:
    identities = pd.read_csv(IDENTITY_FILE, dtype={"player_id": "string", "sleeper_player_id": "string"}, keep_default_na=False)
    weekly = pd.read_csv(WEEKLY_FILE, dtype={"player_id": "string", "sleeper_player_id": "string", "game_id": "string", "season_type": "string"}, low_memory=False)
    missing_identity = PLAYER_REQUIRED - set(identities.columns)
    missing_weekly = WEEKLY_REQUIRED - set(weekly.columns)
    if missing_identity or missing_weekly:
        raise ValueError(f"Missing columns — identity: {sorted(missing_identity)}, weekly: {sorted(missing_weekly)}")
    if identities.empty or weekly.empty:
        raise ValueError("Identity and weekly files must both contain data.")
    if identities["player_id"].duplicated().any():
        raise ValueError("player_identity.csv contains duplicate GSIS player IDs.")
    sleeper_ids = identities["sleeper_player_id"].fillna("").astype("string")
    if sleeper_ids.str.endswith(".0").any() or sleeper_ids[sleeper_ids.ne("")].str.contains(r"\s").any():
        raise ValueError("Sleeper IDs must be text values without .0 suffixes or whitespace.")
    if weekly[["player_id", "season", "week"]].isna().any().any():
        raise ValueError("Weekly data has missing player_id, season, or week values.")
    unknown = set(weekly["player_id"].dropna()) - set(identities["player_id"])
    if unknown:
        raise ValueError(f"Weekly data references {len(unknown)} player IDs absent from player_identity.csv.")
    duplicates = weekly.duplicated(LOGICAL_WEEKLY_KEY, keep=False)
    if duplicates.any():
        raise ValueError(f"Weekly data contains {int(duplicates.sum())} duplicate logical rows; import aborted.")
    seasons = set(pd.to_numeric(weekly["season"], errors="raise").astype(int).unique())
    if seasons != EXPECTED_SEASONS:
        raise ValueError(f"Expected seasons 2012–2025, found: {sorted(seasons)}")
    weeks = pd.to_numeric(weekly["week"], errors="raise")
    if not weeks.between(1, 30).all():
        raise ValueError("Weekly data contains an invalid week outside 1–30.")
    if not weekly["season_type"].isin(["REG", "POST"]).all():
        raise ValueError("Weekly data contains a season_type other than REG or POST.")
    return identities, weekly


class SupabaseRest:
    def __init__(self, url: str, service_key: str):
        self.base_url = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    def request(self, method: str, path: str, body: Any = None, extra_headers: dict[str, str] | None = None) -> Any:
        payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        headers = {**self.headers, "Accept": "application/json", **(extra_headers or {})}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base_url + path, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"Supabase {method} {path.split('?')[0]} failed ({error.code}): {detail}") from error

    def fetch_all_players(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page_size = 1000
        for offset in range(0, 100_000, page_size):
            query = urllib.parse.urlencode({"select": "id,gsis_id,sleeper_player_id"})
            page = self.request("GET", f"/players?{query}", extra_headers={"Range": f"{offset}-{offset + page_size - 1}"}) or []
            rows.extend(page)
            if len(page) < page_size:
                break
        return rows

    def upsert(self, table: str, rows: list[dict[str, Any]], conflict: str) -> None:
        query = urllib.parse.urlencode({"on_conflict": conflict})
        self.request("POST", f"/{table}?{query}", rows, {"Prefer": "resolution=merge-duplicates,return=minimal"})


def plan_player_upserts(identities: pd.DataFrame, existing: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int, int]:
    by_gsis = {row["gsis_id"]: row for row in existing if row.get("gsis_id")}
    by_sleeper = {str(row["sleeper_player_id"]): row for row in existing if row.get("sleeper_player_id")}
    payloads = []
    inserted = updated = 0
    for row in identities.to_dict("records"):
        gsis_id = str(row["player_id"])
        sleeper_id = str(row.get("sleeper_player_id") or "")
        gsis_match = by_gsis.get(gsis_id)
        sleeper_match = by_sleeper.get(sleeper_id) if sleeper_id else None
        if gsis_match and sleeper_match and gsis_match["id"] != sleeper_match["id"]:
            raise ValueError(f"GSIS {gsis_id} and Sleeper {sleeper_id} refer to different existing player rows.")
        existing_row = gsis_match or sleeper_match
        player_uuid = existing_row["id"] if existing_row else str(uuid.uuid4())
        updated += bool(existing_row)
        inserted += not bool(existing_row)
        fantasy_positions = [item for item in str(row.get("sleeper_fantasy_positions") or "").split("|") if item]
        sleeper_position = str(row.get("sleeper_position") or "") or None
        historical_position = str(row.get("historical_position") or "") or None
        current_team = str(row.get("sleeper_current_team") or "") or None
        payloads.append({
            "id": player_uuid, "gsis_id": gsis_id, "pfr_player_id": str(row.get("pfr_player_id") or "") or None,
            "sleeper_player_id": sleeper_id or None, "full_name": str(row["player_name"]),
            "position": sleeper_position or historical_position, "historical_position": historical_position,
            "sleeper_position": sleeper_position, "sleeper_fantasy_positions": fantasy_positions,
            "team": current_team,
            "birth_date": str(row.get("birth_date") or "") or None, "height": clean_integer(row.get("height")),
            "weight": clean_integer(row.get("weight")), "college": str(row.get("college_name") or "") or None,
            "rookie_season": clean_integer(row.get("rookie_season")),
            "metadata": {"historical_team": str(row.get("historical_team") or ""), "mapping_method": str(row.get("match_method") or ""), "mapping_confidence": str(row.get("confidence") or "")},
        })
    return payloads, int(inserted), int(updated)


def prepare_weekly_payloads(weekly: pd.DataFrame, player_ids: dict[str, str]) -> list[dict[str, Any]]:
    payloads = []
    for source in weekly.to_dict("records"):
        gsis_id = str(source["player_id"])
        if gsis_id not in player_ids:
            raise ValueError(f"No internal UUID was found for GSIS player {gsis_id}.")
        numeric_stats = {WEEKLY_RENAMES.get(key, key): clean(value) for key, value in source.items() if key not in CONTEXT_COLUMNS}
        payloads.append({
            "player_id": player_ids[gsis_id], "season": int(source["season"]), "week": int(source["week"]),
            "season_type": str(source["season_type"]), "game_id": str(source["game_id"]),
            "team": clean(source.get("team")), "provider": "kaggle", "stats": numeric_stats,
            **numeric_stats,
        })
    return payloads


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Validate and summarize without network access or writes.")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 2000:
        parser.error("--batch-size must be between 1 and 2000")
    started = time.monotonic()
    identities, weekly = load_and_validate_inputs()
    seasons = sorted(weekly["season"].astype(int).unique())
    print(f"Validated {len(identities):,} player identities and {len(weekly):,} weekly rows.")
    print(f"Seasons: {seasons[0]}–{seasons[-1]}; logical duplicates: 0")
    if args.dry_run:
        print("Dry run complete. No network requests or database writes were made.")
        return 0
    load_local_environment()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        raise RuntimeError("Live import requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.")
    client = SupabaseRest(url, service_key)
    existing = client.fetch_all_players()
    player_payloads, inserted, updated = plan_player_upserts(identities, existing)
    total_player_batches = (len(player_payloads) + args.batch_size - 1) // args.batch_size
    for number, batch in batched(player_payloads, args.batch_size):
        client.upsert("players", batch, "id")
        print(f"Players batch {number}/{total_player_batches} upserted ({len(batch):,} rows)")
    # Read back authoritative UUIDs after the identity upsert.
    imported_players = client.fetch_all_players()
    gsis_to_uuid = {row["gsis_id"]: row["id"] for row in imported_players if row.get("gsis_id")}
    missing = set(identities["player_id"]) - set(gsis_to_uuid)
    if missing:
        raise RuntimeError(f"Player read-back validation failed for {len(missing)} GSIS IDs.")
    weekly_payloads = prepare_weekly_payloads(weekly, gsis_to_uuid)
    total_weekly_batches = (len(weekly_payloads) + args.batch_size - 1) // args.batch_size
    for number, batch in batched(weekly_payloads, args.batch_size):
        client.upsert("player_weekly_nfl_statistics", batch, "player_id,season,week,season_type,game_id,provider")
        print(f"Weekly batch {number}/{total_weekly_batches} upserted ({len(batch):,} rows)")
    print("\n========== IMPORT COMPLETE ==========")
    print(f"Players inserted:          {inserted:,}")
    print(f"Players updated:           {updated:,}")
    print(f"Weekly rows upserted:      {len(weekly_payloads):,}")
    print("Weekly rows skipped:       0")
    print("Failures:                  0")
    print(f"Elapsed:                   {time.monotonic() - started:.1f}s")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"Import failed: {error}", file=sys.stderr)
        sys.exit(1)
