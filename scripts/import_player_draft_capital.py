#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

if __package__:
    from .import_player_projections import SupabaseRest, chunks, load_local_environment
else:
    from import_player_projections import SupabaseRest, chunks, load_local_environment

REQUIRED = {
    "gsis_id", "draft_year", "draft_round", "draft_pick", "draft_team",
    "draft_status", "provider", "fetched_at",
}


def nullable_integer(value: object) -> int | None:
    return None if pd.isna(value) else int(value)


def build_updates(frame: pd.DataFrame, player_ids: dict[str, str]) -> list[dict]:
    updates: list[dict] = []
    for row in frame.to_dict("records"):
        player_id = player_ids.get(str(row["gsis_id"]))
        if not player_id:
            continue
        updates.append({
            "id": player_id,
            "draft_year": nullable_integer(row["draft_year"]),
            "draft_round": nullable_integer(row["draft_round"]),
            "draft_pick": nullable_integer(row["draft_pick"]),
            "draft_team": None if pd.isna(row["draft_team"]) else str(row["draft_team"]),
            "draft_status": str(row["draft_status"]),
            "draft_source": str(row["provider"]),
            "draft_updated_at": pd.Timestamp(row["fetched_at"]).isoformat(),
        })
    return updates


def load_canonical_player_ids(client: SupabaseRest, page_size: int = 1000) -> dict[str, str]:
    """Load the small canonical player table once instead of querying every source ID."""
    player_ids: dict[str, str] = {}
    offset = 0
    while True:
        rows = client.request(
            "GET",
            "players?select=id,gsis_id&gsis_id=not.is.null"
            f"&order=id&limit={page_size}&offset={offset}",
        )
        player_ids.update({str(row["gsis_id"]): str(row["id"]) for row in rows})
        if len(rows) < page_size:
            return player_ids
        offset += page_size


def main() -> None:
    parser = argparse.ArgumentParser(description="Import nflverse draft capital onto canonical players.")
    parser.add_argument("--input", type=Path, default=Path("data/processed/player_draft_capital.csv"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    frame = pd.read_csv(args.input, dtype={"gsis_id": "string"})
    missing = REQUIRED.difference(frame.columns)
    if missing:
        raise ValueError(f"Draft capital export is missing columns: {sorted(missing)}")
    if frame.gsis_id.duplicated().any():
        raise ValueError("Draft capital export contains duplicate GSIS identities")
    if not set(frame.draft_status.dropna()).issubset({"drafted", "undrafted", "unknown"}):
        raise ValueError("Draft capital export contains an invalid draft_status")
    if args.dry_run:
        print(f"Validated {len(frame):,} draft-capital rows; no remote writes performed.")
        return

    load_local_environment()
    client = SupabaseRest()
    player_ids = load_canonical_player_ids(client)
    print(f"Loaded {len(player_ids):,} canonical GSIS identities.")
    updates = build_updates(frame, player_ids)
    for number, batch in enumerate(chunks(updates), start=1):
        client.request("POST", "rpc/update_player_draft_capital", {"records": batch})
        print(f"Draft-capital batch {number} upserted ({len(batch)} rows)")
    print(f"Updated {len(updates):,} canonical players; {len(frame) - len(updates):,} lacked a canonical GSIS match.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Draft-capital import failed: {error}", file=sys.stderr)
        raise SystemExit(1)
