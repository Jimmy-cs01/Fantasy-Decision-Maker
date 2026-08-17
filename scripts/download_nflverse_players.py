#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

SOURCE_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"
OUTPUT = Path("data/processed/player_draft_capital.csv")
USECOLS = [
    "gsis_id", "display_name", "pfr_id", "position", "rookie_season",
    "draft_year", "draft_round", "draft_pick", "draft_team",
]
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K"}


def normalize_draft_capital(frame: pd.DataFrame, fetched_at: str | None = None) -> pd.DataFrame:
    output = frame.copy()
    output = output.loc[output["gsis_id"].notna()].drop_duplicates("gsis_id", keep="last")
    for column in ["rookie_season", "draft_year", "draft_round", "draft_pick"]:
        output[column] = pd.to_numeric(output[column], errors="coerce").astype("Int64")
    has_draft = output[["draft_year", "draft_round", "draft_pick"]].notna().any(axis=1)
    # nflverse draft records are sourced from PFR and cover drafts from 2000 onward.
    # A player with a PFR identity who reached the NFL in that era but has no draft
    # record is a confirmed UDFA for this enrichment. All other absences stay unknown.
    confirmed_udfa = (
        ~has_draft
        & output["pfr_id"].notna()
        & output["rookie_season"].ge(2000)
        & output["position"].isin(FANTASY_POSITIONS)
    )
    output["draft_status"] = "unknown"
    output.loc[has_draft, "draft_status"] = "drafted"
    output.loc[confirmed_udfa, "draft_status"] = "undrafted"
    output["provider"] = "nflverse/players"
    output["fetched_at"] = fetched_at or datetime.now(timezone.utc).isoformat()
    return output[[
        "gsis_id", "display_name", "position", "rookie_season", "draft_year",
        "draft_round", "draft_pick", "draft_team", "draft_status", "provider",
        "fetched_at",
    ]].sort_values(["display_name", "gsis_id"], na_position="last")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download normalized nflverse player draft metadata.")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    source = pd.read_csv(SOURCE_URL, usecols=USECOLS, dtype={"gsis_id": "string", "pfr_id": "string"})
    output = normalize_draft_capital(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False)
    fantasy = output[output.position.isin(FANTASY_POSITIONS)]
    covered = fantasy.draft_status.isin(["drafted", "undrafted"]).sum()
    print(f"Wrote {len(output):,} nflverse player identities with draft context.")
    print(f"Fantasy-position draft coverage: {covered:,}/{len(fantasy):,} ({covered / max(1, len(fantasy)):.1%})")
    print(f"Output: {args.output.resolve()}")


if __name__ == "__main__":
    main()
