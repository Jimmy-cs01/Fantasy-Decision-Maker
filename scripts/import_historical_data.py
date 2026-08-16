"""Import canonical nflverse historical data through Supabase PostgREST.

Normal imports are idempotent upserts. Provider replacement is deliberately
separate: ``--replace-source`` validates every local row before deleting only
nflverse weekly NFL statistics in the locally discovered season range, then loads the dataset. No player,
Sleeper, league, roster, or authentication records are deleted.
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
FIRST_HISTORICAL_SEASON = 2012
LOGICAL_WEEKLY_KEY = ["player_id", "season", "week", "season_type", "game_id"]
PLAYER_REQUIRED = {"player_id", "player_name", "historical_position", "sleeper_player_id"}
WEEKLY_REQUIRED = set(LOGICAL_WEEKLY_KEY + ["team", "historical_position", "source", "source_dataset", "source_season", "fantasy_points_standard", "fantasy_points_half_ppr", "fantasy_points_ppr"])
WEEKLY_RENAMES = {
    "passing_first_downs": "first_down_passes",
}
CONTEXT_COLUMNS = {
    "player_id", "sleeper_player_id", "season", "week", "season_type", "game_id", "team",
    "opponent_team", "historical_position", "source", "source_dataset", "source_season",
}
MAX_REQUEST_ATTEMPTS = 6
RETRYABLE_HTTP_STATUSES = {408, 425, 429, 500, 502, 503, 504}


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
    expected_seasons = set(range(min(seasons), max(seasons) + 1))
    if min(seasons) != FIRST_HISTORICAL_SEASON:
        raise ValueError(
            f"Historical weekly data must begin at {FIRST_HISTORICAL_SEASON}; found {min(seasons)}."
        )
    if seasons != expected_seasons:
        raise ValueError(f"Historical weekly data has a season gap: {sorted(expected_seasons - seasons)}")
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
        endpoint = path.split("?", 1)[0]
        for attempt in range(1, MAX_REQUEST_ATTEMPTS + 1):
            request = urllib.request.Request(self.base_url + path, data=payload, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    raw = response.read()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as error:
                detail = error.read().decode(errors="replace")
                if error.code not in RETRYABLE_HTTP_STATUSES or attempt == MAX_REQUEST_ATTEMPTS:
                    raise RuntimeError(f"Supabase {method} {endpoint} failed ({error.code}): {detail}") from error
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
                        f"Supabase {method} {endpoint} failed after {MAX_REQUEST_ATTEMPTS} attempts: {error}"
                    ) from error
                delay = min(2 ** (attempt - 1), 16)
                print(
                    f"Transient connection failure during {method} {endpoint}: {error}; "
                    f"retrying in {delay}s ({attempt}/{MAX_REQUEST_ATTEMPTS})..."
                )
                time.sleep(delay)
        raise AssertionError("Supabase request retry loop exited unexpectedly.")

    def fetch_all_players(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page_size = 1000
        for offset in range(0, 100_000, page_size):
            query = urllib.parse.urlencode({"select": "id,gsis_id,sleeper_player_id,headshot_url"})
            page = self.request("GET", f"/players?{query}", extra_headers={"Range": f"{offset}-{offset + page_size - 1}"}) or []
            rows.extend(page)
            if len(page) < page_size:
                break
        return rows

    def upsert(self, table: str, rows: list[dict[str, Any]], conflict: str) -> None:
        query = urllib.parse.urlencode({"on_conflict": conflict})
        self.request("POST", f"/{table}?{query}", rows, {"Prefer": "resolution=merge-duplicates,return=minimal"})

    def delete_historical_weekly_stats(self, first_season: int, last_season: int, provider: str = "nflverse") -> int:
        """Delete provider rows in small, resumable season/type partitions.

        A single range-wide delete can exceed hosted Postgres statement limits.
        Each request is independently committed, so rerunning replacement mode
        after an interruption safely continues from the remaining partitions.
        """
        deleted_partitions = 0
        for season in range(first_season, last_season + 1):
            for season_type in ("REG", "POST"):
                query = urllib.parse.urlencode([
                    ("season", f"eq.{season}"),
                    ("season_type", f"eq.{season_type}"),
                    ("provider", f"eq.{provider}"),
                ])
                try:
                    self.request(
                        "DELETE",
                        f"/player_weekly_nfl_statistics?{query}",
                        extra_headers={"Prefer": "return=minimal"},
                    )
                except RuntimeError as error:
                    raise RuntimeError(
                        f"Failed to delete {provider} rows for {season} {season_type}: {error}"
                    ) from error
                deleted_partitions += 1
        return deleted_partitions

    def count_historical_weekly_stats(self, first_season: int, last_season: int, provider: str | None = None) -> int:
        filters = [("select", "id"), ("season", f"gte.{first_season}"), ("season", f"lte.{last_season}")]
        if provider:
            filters.append(("provider", f"eq.{provider}"))
        request = urllib.request.Request(
            self.base_url + "/player_weekly_nfl_statistics?" + urllib.parse.urlencode(filters),
            headers={**self.headers, "Accept": "application/json", "Prefer": "count=exact", "Range": "0-0"},
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                content_range = response.headers.get("Content-Range", "")
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"Supabase count failed ({error.code}): {detail}") from error
        if "/" not in content_range or content_range.endswith("/*"):
            raise RuntimeError(f"Supabase did not return an exact row count: {content_range!r}")
        return int(content_range.rsplit("/", 1)[1])


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
        incoming_headshot = clean(row.get("headshot_url"))
        existing_headshot = clean(existing_row.get("headshot_url")) if existing_row else None
        payloads.append({
            "id": player_uuid, "gsis_id": gsis_id, "pfr_player_id": str(row.get("pfr_player_id") or "") or None,
            "sleeper_player_id": sleeper_id or None, "full_name": str(row["player_name"]),
            "position": sleeper_position or historical_position, "historical_position": historical_position,
            "sleeper_position": sleeper_position, "sleeper_fantasy_positions": fantasy_positions,
            "team": current_team,
            "headshot_url": incoming_headshot or existing_headshot,
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
        provider = str(source["source"])
        if provider != "nflverse":
            raise ValueError(f"Expected nflverse source metadata, found {provider!r}.")
        payloads.append({
            "player_id": player_ids[gsis_id], "season": int(source["season"]), "week": int(source["week"]),
            "season_type": str(source["season_type"]), "game_id": str(source["game_id"]),
            "team": clean(source.get("team")), "opponent_team": clean(source.get("opponent_team")),
            "historical_position": clean(source.get("historical_position")), "provider": provider,
            "source_dataset": clean(source.get("source_dataset")), "source_season": int(source["source_season"]),
            "stats": {**numeric_stats, "source_dataset": clean(source.get("source_dataset")), "source_season": int(source["source_season"])},
            **numeric_stats,
        })
    return payloads


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Validate and summarize without network access or writes.")
    parser.add_argument("--replace-source", action="store_true", help="Delete only nflverse weekly rows in the validated local season range before importing.")
    parser.add_argument("--verify-only", action="store_true", help="Compare remote nflverse row counts with the validated local output without writing.")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 2000:
        parser.error("--batch-size must be between 1 and 2000")
    started = time.monotonic()
    identities, weekly = load_and_validate_inputs()
    seasons = sorted(weekly["season"].astype(int).unique())
    print(f"Validated {len(identities):,} player identities and {len(weekly):,} weekly rows.")
    print(f"Seasons: {seasons[0]}–{seasons[-1]}; logical duplicates: 0")
    print("Provider: nflverse/player_stats")
    if args.dry_run:
        if args.replace_source:
            print(f"Replacement plan: delete provider=nflverse weekly rows for {seasons[0]}–{seasons[-1]} only, then import validated rows.")
        print("Dry run complete. No network requests or database writes were made.")
        return 0
    load_local_environment()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        raise RuntimeError("Live import requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.")
    client = SupabaseRest(url, service_key)
    if args.verify_only:
        remote_nflverse = client.count_historical_weekly_stats(seasons[0], seasons[-1], "nflverse")
        remote_all = client.count_historical_weekly_stats(seasons[0], seasons[-1])
        print(f"Remote nflverse rows: {remote_nflverse:,}; all-provider rows: {remote_all:,}; local expected: {len(weekly):,}")
        if remote_nflverse != len(weekly):
            raise RuntimeError("Remote nflverse row count does not match the validated local dataset.")
        print("Remote provider replacement is complete and row counts match.")
        return 0
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
    if args.replace_source:
        existing_weekly_count = client.count_historical_weekly_stats(seasons[0], seasons[-1], "nflverse")
        print(
            f"Deleting {existing_weekly_count:,} existing nflverse weekly NFL statistics for "
            f"seasons {seasons[0]}–{seasons[-1]} in bounded season/type batches..."
        )
        deleted_partitions = client.delete_historical_weekly_stats(seasons[0], seasons[-1], "nflverse")
        remaining_weekly_count = client.count_historical_weekly_stats(seasons[0], seasons[-1], "nflverse")
        if remaining_weekly_count:
            raise RuntimeError(
                f"Scoped replacement deletion left {remaining_weekly_count:,} nflverse rows; import aborted before upserts."
            )
        print(
            f"Scoped weekly-stat deletion complete across {deleted_partitions} bounded batches; "
            "unrelated tables were not touched."
        )
    total_weekly_batches = (len(weekly_payloads) + args.batch_size - 1) // args.batch_size
    for number, batch in batched(weekly_payloads, args.batch_size):
        client.upsert("player_weekly_nfl_statistics", batch, "player_id,season,week,season_type,game_id,provider")
        print(f"Weekly batch {number}/{total_weekly_batches} upserted ({len(batch):,} rows)")
    remote_count = client.count_historical_weekly_stats(seasons[0], seasons[-1], "nflverse")
    if remote_count != len(weekly_payloads):
        raise RuntimeError(f"Post-import verification found {remote_count:,} nflverse rows; expected {len(weekly_payloads):,}.")
    print("\n========== IMPORT COMPLETE ==========")
    print(f"Players inserted:          {inserted:,}")
    print(f"Players updated:           {updated:,}")
    print(f"Weekly rows upserted:      {len(weekly_payloads):,}")
    print(f"Verified remote rows:      {remote_count:,}")
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
