"""Build the reproducible GSIS/Kaggle player_id -> Sleeper identity bridge.

GSIS IDs are the canonical historical external identity. Sleeper IDs are optional
text provider IDs; a current team or current position never replaces historical data.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import pandas as pd

KAGGLE_FILE = Path("data/weekly_player_stats_offense.csv")
SLEEPER_FILE = Path("data/sleeper_players.json")
OVERRIDES_FILE = Path("data/player_mapping_overrides.csv")
OUTPUT_FILE = Path("data/player_id_mapping.csv")
REVIEW_FILE = Path("data/player_id_mapping_review.csv")
KAGGLE_COLUMNS = ["player_id", "pfr_player_id", "player_name", "position", "position_group", "team", "birth_date", "height", "weight", "college_name", "rookie_season", "years_exp"]
OUTPUT_COLUMNS = ["player_id", "pfr_player_id", "player_name", "historical_position", "position_group", "historical_team", "birth_date", "height", "weight", "college_name", "rookie_season", "sleeper_player_id", "sleeper_name", "sleeper_position", "sleeper_fantasy_positions", "sleeper_current_team", "match_score", "match_method", "confidence"]
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE"}
SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def present(value: Any) -> bool:
    return value is not None and not pd.isna(value) and str(value).strip() != ""


def text(value: Any) -> str:
    return str(value).strip() if present(value) else ""


def normalize_name(value: Any, remove_suffix: bool = False) -> str:
    """Lowercase, remove apostrophes/periods/hyphens, and collapse whitespace."""
    name = text(value).lower().replace("'", "").replace("’", "").replace("‘", "")
    tokens = re.sub(r"[^a-z0-9\s]", " ", name.replace(".", "").replace("-", "")).split()
    if remove_suffix:
        while tokens and tokens[-1] in SUFFIXES:
            tokens.pop()
    return " ".join(tokens)


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]", " ", text(value).lower())).strip()


def normalize_date(value: Any) -> str:
    parsed = pd.to_datetime(value, errors="coerce") if present(value) else pd.NaT
    return "" if pd.isna(parsed) else parsed.date().isoformat()


def normalize_number(value: Any) -> int | None:
    try:
        return int(round(float(value))) if present(value) else None
    except (TypeError, ValueError):
        return None


def normalize_height(value: Any) -> int | None:
    raw = text(value)
    feet_inches = re.fullmatch(r"(\d+)\s*'\s*(\d+)(?:\"|in)?", raw)
    return int(feet_inches.group(1)) * 12 + int(feet_inches.group(2)) if feet_inches else normalize_number(raw)


def load_sleeper_players(payload: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    players = []
    for key, raw in payload.items():
        name = raw.get("full_name") or " ".join(filter(None, [raw.get("first_name"), raw.get("last_name")]))
        if not present(name):
            continue
        metadata = raw.get("metadata") or {}
        fantasy_positions = raw.get("fantasy_positions") or []
        players.append({
            "sleeper_player_id": str(raw.get("player_id") or key), "name": text(name),
            "name_normalized": normalize_name(name), "name_suffixless": normalize_name(name, True),
            "position": text(raw.get("position")).upper(), "fantasy_positions": "|".join(map(str, fantasy_positions)),
            "team": text(raw.get("team")), "birth_date": normalize_date(raw.get("birth_date")),
            "college": normalize_text(raw.get("college")), "rookie_year": normalize_number(metadata.get("rookie_year")),
            "height": normalize_height(raw.get("height")), "weight": normalize_number(raw.get("weight")),
        })
    return players


def canonical_kaggle_player(row: pd.Series) -> dict[str, Any]:
    return {
        "player_id": text(row["player_id"]), "pfr_player_id": text(row["pfr_player_id"]), "player_name": text(row["player_name"]),
        "historical_position": text(row["position"]).upper(), "position_group": text(row["position_group"]), "historical_team": text(row["team"]),
        "birth_date": normalize_date(row["birth_date"]), "height": normalize_height(row["height"]), "weight": normalize_number(row["weight"]),
        "college_name": text(row["college_name"]), "college": normalize_text(row["college_name"]), "rookie_season": normalize_number(row["rookie_season"]),
        "name_normalized": normalize_name(row["player_name"]), "name_suffixless": normalize_name(row["player_name"], True),
    }


def score_candidate(kaggle: dict[str, Any], sleeper: dict[str, Any], name_kind: str) -> tuple[int, int]:
    points = {"exact_full": 50, "exact_suffixless": 45}.get(name_kind, 0)
    corroboration = 0
    comparisons = [("birth_date", "birth_date", 30), ("historical_position", "position", 20), ("college", "college", 10), ("rookie_season", "rookie_year", 10), ("height", "height", 5)]
    for kaggle_field, sleeper_field, weight in comparisons:
        if kaggle[kaggle_field] not in ("", None) and kaggle[kaggle_field] == sleeper[sleeper_field]:
            points += weight
            corroboration += 1
    if kaggle["weight"] is not None and sleeper["weight"] is not None and abs(kaggle["weight"] - sleeper["weight"]) <= 5:
        points += 5
        corroboration += 1
    return points, corroboration


def make_result(kaggle: dict[str, Any], sleeper: dict[str, Any] | None, score: int, method: str, confidence: str) -> dict[str, Any]:
    return {
        "player_id": kaggle["player_id"], "pfr_player_id": kaggle["pfr_player_id"], "player_name": kaggle["player_name"],
        "historical_position": kaggle["historical_position"], "position_group": kaggle["position_group"], "historical_team": kaggle["historical_team"],
        "birth_date": kaggle["birth_date"], "height": kaggle["height"], "weight": kaggle["weight"], "college_name": kaggle["college_name"], "rookie_season": kaggle["rookie_season"],
        "sleeper_player_id": sleeper["sleeper_player_id"] if sleeper else "", "sleeper_name": sleeper["name"] if sleeper else "",
        "sleeper_position": sleeper["position"] if sleeper else "", "sleeper_fantasy_positions": sleeper["fantasy_positions"] if sleeper else "", "sleeper_current_team": sleeper["team"] if sleeper else "",
        "match_score": score, "match_method": method, "confidence": confidence,
    }


def match_player(kaggle: dict[str, Any], exact_names: dict[str, list[dict[str, Any]]], suffixless_names: dict[str, list[dict[str, Any]]], by_position: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    if kaggle["historical_position"] not in FANTASY_POSITIONS:
        return make_result(kaggle, None, 0, "not_attempted", "non_fantasy_position")
    candidates: dict[str, tuple[dict[str, Any], str]] = {}
    # Exact-name candidates intentionally may differ in current position. Their score
    # only gets the position points when the two provider classifications agree.
    for sleeper in exact_names[kaggle["name_normalized"]]:
        candidates[sleeper["sleeper_player_id"]] = (sleeper, "exact_full")
    for sleeper in suffixless_names[kaggle["name_suffixless"]]:
        candidates.setdefault(sleeper["sleeper_player_id"], (sleeper, "exact_suffixless"))
    scored = []
    for sleeper, method in candidates.values():
        points, corroboration = score_candidate(kaggle, sleeper, method)
        # A provider position change is legitimate only with strong independent
        # evidence. This prevents duplicate-name RB/WR records from cross-matching.
        if sleeper["position"] != kaggle["historical_position"] and corroboration < 3:
            continue
        scored.append((points, corroboration, sleeper, method))
    if not scored:
        last_name = kaggle["name_suffixless"].split()[-1:]
        for sleeper in by_position[kaggle["historical_position"]] if last_name else []:
            words = sleeper["name_suffixless"].split()
            if not words or words[-1][0] != last_name[0][0]:
                continue
            similarity = SequenceMatcher(None, kaggle["name_suffixless"], sleeper["name_suffixless"]).ratio()
            metadata_score, corroboration = score_candidate(kaggle, sleeper, "fuzzy")
            if similarity >= 0.90 and corroboration >= 2:  # position plus independent metadata
                scored.append((metadata_score + round(similarity * 20), corroboration, sleeper, "fuzzy_name"))
    if not scored:
        return make_result(kaggle, None, 0, "unmatched", "unmatched")
    scored.sort(key=lambda item: item[0], reverse=True)
    best_score = scored[0][0]
    if sum(item[0] == best_score for item in scored) != 1:
        return make_result(kaggle, None, best_score, "ambiguous_equal_score", "review")
    score, corroboration, sleeper, method = scored[0]
    if method == "fuzzy_name":
        confidence = "medium" if score >= 85 and corroboration >= 3 else "review"
    elif score >= 80 and corroboration >= 2:  # position + one independent identity field
        confidence = "high"
    elif score >= 65:
        confidence = "medium"
    else:
        confidence = "review"
    return make_result(kaggle, sleeper, score, method, confidence)


def load_overrides() -> dict[str, dict[str, str]]:
    overrides = pd.read_csv(OVERRIDES_FILE, dtype={"player_id": "string", "sleeper_player_id": "string"}, keep_default_na=False)
    if overrides["player_id"].duplicated().any():
        raise ValueError("player_mapping_overrides.csv contains duplicate player_id values.")
    return {row.player_id: {"action": row.action, "sleeper_player_id": row.sleeper_player_id} for row in overrides.itertuples(index=False)}


def apply_override(kaggle: dict[str, Any], override: dict[str, str] | None, sleeper_by_id: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    if not override:
        return None
    if override["action"] == "unmatched":
        return make_result(kaggle, None, 0, "manual_unmatched", "unmatched")
    if override["action"] == "match":
        sleeper = sleeper_by_id.get(override["sleeper_player_id"])
        if not sleeper:
            raise ValueError(f"Manual override references missing Sleeper ID {override['sleeper_player_id']}.")
        return make_result(kaggle, sleeper, 999, "manual_verified", "high")
    raise ValueError(f"Unknown override action {override['action']!r} for {kaggle['player_id']}.")


def validate_mapping(mapping: pd.DataFrame) -> None:
    if mapping["player_id"].duplicated().any():
        raise ValueError("Mapping validation failed: duplicate player_id values.")
    ids = mapping["sleeper_player_id"].fillna("").astype("string")
    if ids.str.endswith(".0").any() or ids[ids.ne("")].str.contains(r"\s").any():
        raise ValueError("Mapping validation failed: Sleeper IDs must be text values without a .0 suffix or whitespace.")
    if mapping.loc[mapping["match_method"] == "manual_unmatched", "sleeper_player_id"].fillna("").ne("").any():
        raise ValueError("Mapping validation failed: manual_unmatched row has a Sleeper ID.")
    if not mapping.loc[mapping["match_method"] == "manual_verified", "confidence"].eq("high").all():
        raise ValueError("Mapping validation failed: manual_verified rows must be high confidence.")
    mapped = mapping[mapping["sleeper_player_id"].fillna("").ne("")]
    if mapped["sleeper_player_id"].duplicated().any():
        duplicates = mapped.loc[mapped["sleeper_player_id"].duplicated(keep=False), ["player_id", "sleeper_player_id"]]
        raise ValueError(f"Mapping validation failed: duplicate Sleeper mappings remain:\n{duplicates.to_string(index=False)}")


def main() -> None:
    print("Loading Sleeper players...")
    with SLEEPER_FILE.open() as file:
        sleeper = load_sleeper_players(json.load(file))
    sleeper_by_id = {player["sleeper_player_id"]: player for player in sleeper}
    print(f"Loaded {len(sleeper):,} Sleeper players")
    print("Loading required Kaggle columns...")
    frame = pd.read_csv(KAGGLE_FILE, usecols=KAGGLE_COLUMNS, low_memory=False).drop_duplicates(subset=["player_id"], keep="first")
    kaggle_players = [canonical_kaggle_player(row) for _, row in frame.iterrows()]
    exact_names: dict[str, list[dict[str, Any]]] = defaultdict(list)
    suffixless_names: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_position: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for player in sleeper:
        exact_names[player["name_normalized"]].append(player)
        suffixless_names[player["name_suffixless"]].append(player)
        by_position[player["position"]].append(player)
    overrides = load_overrides()
    rows = [apply_override(player, overrides.get(player["player_id"]), sleeper_by_id) or match_player(player, exact_names, suffixless_names, by_position) for player in kaggle_players]
    mapping = pd.DataFrame(rows, columns=OUTPUT_COLUMNS)
    validate_mapping(mapping)
    review = mapping[mapping["confidence"].isin(["medium", "review"]) | ((mapping["confidence"] == "unmatched") & mapping["historical_position"].isin(FANTASY_POSITIONS))]
    mapping.to_csv(OUTPUT_FILE, index=False)
    review.to_csv(REVIEW_FILE, index=False)
    fantasy = mapping[mapping["historical_position"].isin(FANTASY_POSITIONS)]
    recent = fantasy[fantasy["rookie_season"].fillna(0).astype(int) >= 2020]
    print("\n========== RESULTS ==========")
    print(f"Total Kaggle players:          {len(mapping):,}")
    print(f"Fantasy-position players:      {len(fantasy):,}")
    print(f"Non-fantasy-position players:  {len(mapping) - len(fantasy):,}")
    print(f"High confidence:               {(mapping['confidence'] == 'high').sum():,}")
    print(f"Medium/review:                 {mapping['confidence'].isin(['medium', 'review']).sum():,}")
    print(f"Unmatched:                     {(fantasy['confidence'] == 'unmatched').sum():,}")
    print(f"Overall fantasy-player match:  {fantasy['sleeper_player_id'].ne('').mean() * 100:.1f}%")
    print(f"Recent fantasy players:        {len(recent):,}")
    print(f"Resolved:                      {recent['sleeper_player_id'].ne('').sum():,}")
    print(f"Unresolved:                    {recent['sleeper_player_id'].eq('').sum():,}")
    print(f"Recent coverage:               {recent['sleeper_player_id'].ne('').mean() * 100:.1f}%")
    print(f"Mapping: {OUTPUT_FILE}\nReview:  {REVIEW_FILE}")


if __name__ == "__main__":
    main()
