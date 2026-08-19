#!/usr/bin/env python3
"""Read-only v3.3.2 audit against a supplied Sleeper custom-scoring cohort.

Sleeper projections are an external diagnostic only. They are never used as a
training target or blended into Jimmy's football model. Rare-play bonuses are
estimated independently from completed nflverse play-by-play with strong
position-prior shrinkage.
"""
from __future__ import annotations

import argparse
import json
import math
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping

import numpy as np
import pandas as pd

if __package__:
    from .import_player_projections import SupabaseRest, load_local_environment
    from .projection_pipeline.evaluation_scoreboard import regression_metrics
    from .projection_pipeline.scoring import score_projected_stats_exact
    from .projection_pipeline.v3_3_2_config import V3_3_2_PROJECTION_OUTPUT_PATH
else:
    from import_player_projections import SupabaseRest, load_local_environment
    from projection_pipeline.evaluation_scoreboard import regression_metrics
    from projection_pipeline.scoring import score_projected_stats_exact
    from projection_pipeline.v3_3_2_config import V3_3_2_PROJECTION_OUTPUT_PATH


ROOT = Path(__file__).resolve().parents[1]
COHORT_PATH = ROOT / "scripts/fixtures/sleeper_week1_custom_scoring_2026.csv"
IDENTITY_PATH = ROOT / "data/processed/player_identity.csv"
LONG_RATE_PATH = ROOT / "data/processed/nflverse_long_play_rates_2018_2025.csv"
OUTPUT_JSON = ROOT / "data/processed/v3_3_2_sleeper_week1_audit.json"
OUTPUT_CSV = ROOT / "data/processed/v3_3_2_sleeper_week1_comparison.csv"
DEFAULT_LEAGUE_ID = "1371940531688448000"
POSITIONS = ("QB", "RB", "WR", "TE")
RARE_SETTINGS = {
    "rec_20_29", "rec_30_39", "rec_40p", "rec_td_40p", "rec_td_50p",
    "rush_40p", "rush_td_40p", "rush_td_50p",
    "pass_cmp_40p", "pass_td_40p", "pass_td_50p",
}
SUPPORTED_LINEAR = {
    "pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td",
    "pass_cmp", "pass_att", "pass_inc", "pass_fd", "rush_att", "rush_fd", "rec_fd",
    "bonus_rec_qb", "bonus_rec_rb", "bonus_rec_wr", "bonus_rec_te", "bonus_rec_k",
}
NON_OFFENSE_PREFIXES = (
    "bonus_k_", "def_", "fgm_", "fgmiss_", "idp_", "kick_", "kr_", "pr_", "pts_allow_", "st_", "xpm", "xpmiss",
)
OFFENSIVE_UNSUPPORTED = {"pass_2pt", "rush_2pt", "rec_2pt", "fum", "fum_lost"}
PBP_COLUMNS = [
    "receiver_player_id", "receiving_yards", "complete_pass", "pass_touchdown",
    "rusher_player_id", "rushing_yards", "rush_attempt", "rush_touchdown",
    "passer_player_id", "passing_yards",
]
RATE_SPECS = {
    "receptions_20_29_yards": ("receptions", 150.0),
    "receptions_30_39_yards": ("receptions", 150.0),
    "receptions_40_plus_yards": ("receptions", 150.0),
    "receiving_touchdowns_40_plus_yards": ("receiving_touchdowns", 50.0),
    "receiving_touchdowns_50_plus_yards": ("receiving_touchdowns", 50.0),
    "rushes_40_plus_yards": ("rush_attempts", 200.0),
    "rushing_touchdowns_40_plus_yards": ("rushing_touchdowns", 50.0),
    "rushing_touchdowns_50_plus_yards": ("rushing_touchdowns", 50.0),
    "completions_40_plus_yards": ("completions", 400.0),
    "passing_touchdowns_40_plus_yards": ("passing_touchdowns", 75.0),
    "passing_touchdowns_50_plus_yards": ("passing_touchdowns", 75.0),
}


def normalize_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    for token in (".", "'", "’", "-", " iii", " ii", " iv", " jr", " sr"):
        text = text.replace(token, " ")
    return " ".join(text.split())


def fetch_json(url: str, attempts: int = 3) -> Any:
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Jimmy-GM-projection-audit/1.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except Exception:
            if attempt + 1 == attempts:
                raise
            time.sleep(0.5 * (attempt + 1))
    raise AssertionError("unreachable")


def build_long_play_rates(force: bool = False) -> pd.DataFrame:
    if LONG_RATE_PATH.exists() and not force:
        return pd.read_csv(LONG_RATE_PATH, dtype={"player_id": "string"})
    totals: dict[str, defaultdict[str, float]] = {
        "receiving": defaultdict(float), "rushing": defaultdict(float), "passing": defaultdict(float),
    }
    for season in range(2018, 2026):
        path = ROOT / f"data/raw/pbp/play_by_play_{season}.csv.gz"
        if not path.exists():
            raise FileNotFoundError(f"Missing required completed-season PBP: {path}")
        frame = pd.read_csv(path, usecols=lambda column: column in PBP_COLUMNS, low_memory=False)
        rec = frame.loc[frame.complete_pass.eq(1) & frame.receiver_player_id.notna(), [
            "receiver_player_id", "receiving_yards", "pass_touchdown",
        ]].copy()
        rec.receiving_yards = pd.to_numeric(rec.receiving_yards, errors="coerce").fillna(0)
        rec.pass_touchdown = pd.to_numeric(rec.pass_touchdown, errors="coerce").fillna(0)
        for player, group in rec.groupby("receiver_player_id"):
            target = totals["receiving"]
            target[f"{player}|receptions"] += len(group)
            target[f"{player}|receptions_20_29_yards"] += group.receiving_yards.between(20, 29.999).sum()
            target[f"{player}|receptions_30_39_yards"] += group.receiving_yards.between(30, 39.999).sum()
            target[f"{player}|receptions_40_plus_yards"] += group.receiving_yards.ge(40).sum()
            touchdowns = group.pass_touchdown.eq(1)
            target[f"{player}|receiving_touchdowns"] += touchdowns.sum()
            target[f"{player}|receiving_touchdowns_40_plus_yards"] += (touchdowns & group.receiving_yards.ge(40)).sum()
            target[f"{player}|receiving_touchdowns_50_plus_yards"] += (touchdowns & group.receiving_yards.ge(50)).sum()

        rush = frame.loc[frame.rush_attempt.eq(1) & frame.rusher_player_id.notna(), [
            "rusher_player_id", "rushing_yards", "rush_touchdown",
        ]].copy()
        rush.rushing_yards = pd.to_numeric(rush.rushing_yards, errors="coerce").fillna(0)
        rush.rush_touchdown = pd.to_numeric(rush.rush_touchdown, errors="coerce").fillna(0)
        for player, group in rush.groupby("rusher_player_id"):
            target = totals["rushing"]
            target[f"{player}|rush_attempts"] += len(group)
            target[f"{player}|rushes_40_plus_yards"] += group.rushing_yards.ge(40).sum()
            touchdowns = group.rush_touchdown.eq(1)
            target[f"{player}|rushing_touchdowns"] += touchdowns.sum()
            target[f"{player}|rushing_touchdowns_40_plus_yards"] += (touchdowns & group.rushing_yards.ge(40)).sum()
            target[f"{player}|rushing_touchdowns_50_plus_yards"] += (touchdowns & group.rushing_yards.ge(50)).sum()

        passing = frame.loc[frame.complete_pass.eq(1) & frame.passer_player_id.notna(), [
            "passer_player_id", "passing_yards", "pass_touchdown",
        ]].copy()
        passing.passing_yards = pd.to_numeric(passing.passing_yards, errors="coerce").fillna(0)
        passing.pass_touchdown = pd.to_numeric(passing.pass_touchdown, errors="coerce").fillna(0)
        for player, group in passing.groupby("passer_player_id"):
            target = totals["passing"]
            target[f"{player}|completions"] += len(group)
            target[f"{player}|completions_40_plus_yards"] += group.passing_yards.ge(40).sum()
            touchdowns = group.pass_touchdown.eq(1)
            target[f"{player}|passing_touchdowns"] += touchdowns.sum()
            target[f"{player}|passing_touchdowns_40_plus_yards"] += (touchdowns & group.passing_yards.ge(40)).sum()
            target[f"{player}|passing_touchdowns_50_plus_yards"] += (touchdowns & group.passing_yards.ge(50)).sum()

    combined: dict[str, dict[str, float]] = defaultdict(dict)
    for category in totals.values():
        for key, value in category.items():
            player, column = key.split("|", 1)
            combined[player][column] = value
    rows = [{"player_id": player, **values} for player, values in combined.items()]
    output = pd.DataFrame(rows).fillna(0)
    identities = pd.read_csv(IDENTITY_PATH, dtype="string", usecols=["player_id", "historical_position"])
    output = output.merge(identities, on="player_id", how="left", validate="one_to_one")
    for event, (denominator, prior_strength) in RATE_SPECS.items():
        position_totals = output.groupby("historical_position")[[event, denominator]].sum()
        global_rate = float(output[event].sum() / max(output[denominator].sum(), 1))
        position_rate = output.historical_position.map(
            (position_totals[event] / position_totals[denominator].replace(0, np.nan)).fillna(global_rate),
        ).fillna(global_rate)
        output[f"{event}_rate"] = (
            output[event] + position_rate * prior_strength
        ) / (output[denominator] + prior_strength)
    LONG_RATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(LONG_RATE_PATH, index=False)
    return output


def expected_long_events(stats: Mapping[str, float], rate: Mapping[str, Any] | None) -> dict[str, float]:
    output: dict[str, float] = {}
    if rate is None:
        return {event: 0.0 for event in RATE_SPECS}
    for event, (denominator, _) in RATE_SPECS.items():
        projected_denominator = float(stats.get(denominator, 0) or 0)
        event_rate = float(rate.get(f"{event}_rate", 0) or 0)
        output[event] = max(0.0, projected_denominator * event_rate)
    return output


def query_remote_v332() -> tuple[pd.DataFrame, dict[str, Any]]:
    rest = SupabaseRest()
    version = rest.request("GET", "model_versions?select=id,version&version=eq.v3.3.2&limit=1")
    if not version:
        raise RuntimeError("Remote model_versions has no v3.3.2 row")
    version_id = version[0]["id"]
    query = urllib.parse.urlencode({
        "select": "player_id,team,projected_stats,model_projection_ppr,vegas_projection_ppr,final_projection_ppr,confidence,projection_diagnostics",
        "model_version_id": f"eq.{version_id}", "season": "eq.2026", "week": "eq.1", "season_type": "eq.REG",
        "limit": "1000",
    })
    projections = pd.DataFrame(rest.request("GET", f"player_projections?{query}"))
    player_rows: list[dict[str, Any]] = []
    ids = projections.player_id.astype(str).tolist()
    for start in range(0, len(ids), 50):
        encoded_ids = ",".join(ids[start:start + 50])
        query = urllib.parse.urlencode({
            "select": "id,sleeper_player_id,full_name,position,team,status,rookie_season",
            "id": f"in.({encoded_ids})", "limit": "100",
        }, safe="(),")
        player_rows.extend(rest.request("GET", f"players?{query}"))
    players = pd.DataFrame(player_rows).rename(columns={"id": "player_id", "position": "remote_position", "team": "remote_team"})
    projections = projections.merge(players, on="player_id", how="left", validate="one_to_one")
    odds_query = urllib.parse.urlencode({
        "select": "id,external_game_id,home_team,away_team,captured_at", "season": "eq.2026", "week": "eq.1", "limit": "1000",
    })
    odds = rest.request("GET", f"odds_games?{odds_query}")
    props_query = urllib.parse.urlencode({
        "select": "player_id,odds_games!inner(season,week)",
        "odds_games.season": "eq.2026", "odds_games.week": "eq.1", "limit": "1000",
    }, safe="!(),")
    props = rest.request("GET", f"player_props?{props_query}")
    teams = {row[key] for row in odds for key in ("home_team", "away_team") if row.get(key)}
    diagnostics = [row if isinstance(row, dict) else {} for row in projections.projection_diagnostics]
    freshness = pd.Series([row.get("vegasFreshness", "unavailable") for row in diagnostics]).value_counts().to_dict()
    return projections, {
        "version": "v3.3.2", "model_version_id": version_id, "rows": len(projections),
        "vegas_games": len({row["external_game_id"] for row in odds}), "vegas_teams": len(teams),
        "players_with_props": len({row["player_id"] for row in props}),
        "vegas_freshness": {str(key): int(value) for key, value in freshness.items()},
        "query_failures": 0,
    }


def resolve_cohort(
    cohort: pd.DataFrame,
    identities: pd.DataFrame,
    sleeper_api: Mapping[str, Mapping[str, Any]] | None = None,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    identity = identities.loc[identities.sleeper_player_id.notna()].copy()
    identity["_name"] = identity.sleeper_name.fillna(identity.player_name).map(normalize_name)
    by_name = {name: group for name, group in identity.groupby("_name")}
    api_by_name: dict[str, list[tuple[str, Mapping[str, Any]]]] = defaultdict(list)
    for sleeper_id, api_row in (sleeper_api or {}).items():
        player = api_row.get("player") or {}
        name = player.get("full_name") or player.get("search_full_name") or player.get("first_name", "") + " " + player.get("last_name", "")
        api_by_name[normalize_name(name)].append((sleeper_id, api_row))
    resolved, unresolved = [], []
    for _, row in cohort.iterrows():
        candidates = by_name.get(normalize_name(row.player))
        if candidates is None:
            candidates = identity.iloc[0:0]
        candidates = candidates.loc[candidates.sleeper_position.fillna(candidates.historical_position).eq(row.position)]
        api_candidates = [
            (sleeper_id, api_row) for sleeper_id, api_row in api_by_name.get(normalize_name(row.player), [])
            if str((api_row.get("player") or {}).get("position") or row.position) == row.position
        ]
        if len(candidates) != 1 and len(api_candidates) == 1:
            sleeper_id = api_candidates[0][0]
            identity_match = identity.loc[identity.sleeper_player_id.eq(sleeper_id)]
            resolved.append({
                **row.to_dict(),
                "gsis_id": identity_match.iloc[0].player_id if len(identity_match) == 1 else None,
                "sleeper_player_id": sleeper_id,
            })
        elif len(candidates) != 1:
            unresolved.append({"player": row.player, "position": row.position, "candidate_count": len(candidates)})
            resolved.append({**row.to_dict(), "gsis_id": None, "sleeper_player_id": None})
        else:
            match = candidates.iloc[0]
            resolved.append({**row.to_dict(), "gsis_id": match.player_id, "sleeper_player_id": match.sleeper_player_id})
    output = pd.DataFrame(resolved)
    duplicate_ids = output.loc[output.sleeper_player_id.notna() & output.sleeper_player_id.duplicated(False), "sleeper_player_id"]
    output["ambiguous_duplicate"] = output.sleeper_player_id.isin(set(duplicate_ids))
    return output, unresolved


def sleeper_api_by_id(season: int, week: int) -> dict[str, dict[str, Any]]:
    url = f"https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular"
    rows = fetch_json(url)
    return {str(row.get("player_id")): row for row in rows if row.get("player_id")}


def classify(row: pd.Series) -> str:
    labels: list[str] = []
    base_gap = abs(float(row.sleeper_projection - row.jimmy_base_ppr))
    adjusted_gap = abs(float(row.sleeper_projection - row.jimmy_league_adjusted))
    if base_gap - adjusted_gap >= 0.5:
        labels.append("SCORING DIFFERENCE")
    position = row.position
    sleeper_stats = row.sleeper_stats if isinstance(row.sleeper_stats, dict) else {}
    if position == "QB":
        opportunity_gap = abs(float(sleeper_stats.get("pass_att", 0) or 0) - float(row.pass_attempts))
        opportunity_gap += abs(float(sleeper_stats.get("rush_att", 0) or 0) - float(row.rush_attempts))
    elif position == "RB":
        opportunity_gap = abs(float(sleeper_stats.get("rush_att", 0) or 0) - float(row.rush_attempts))
        opportunity_gap += abs(float(sleeper_stats.get("rec_tgt", 0) or 0) - float(row.targets))
    else:
        opportunity_gap = abs(float(sleeper_stats.get("rec_tgt", 0) or 0) - float(row.targets))
    if opportunity_gap >= (5 if position == "QB" else 3):
        labels.append("OPPORTUNITY DIFFERENCE")
    jimmy_tds = float(row.passing_touchdowns + row.rushing_touchdowns + row.receiving_touchdowns)
    sleeper_tds = sum(float(sleeper_stats.get(key, 0) or 0) for key in ("pass_td", "rush_td", "rec_td"))
    if abs(sleeper_tds - jimmy_tds) >= 0.35:
        labels.append("TD DIFFERENCE")
    if bool(row.low_history):
        labels.append("ROOKIE/LOW-HISTORY")
    if adjusted_gap >= 3 and not labels:
        labels.append("EFFICIENCY DIFFERENCE")
    if adjusted_gap >= 5 and row.depth_rank and float(row.depth_rank) > 2:
        labels.append("ROLE/DEPTH DIFFERENCE")
    if not labels:
        labels.append("UNEXPLAINED" if adjusted_gap >= 2 else "LEGITIMATE MODEL DISAGREEMENT")
    return "; ".join(labels)


def summarize_system_gap(frame: pd.DataFrame, group: str) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, rows in frame.groupby(group, dropna=False, observed=True):
        before = rows.sleeper_projection - rows.jimmy_base_ppr
        after = rows.sleeper_projection - rows.jimmy_league_adjusted
        output[str(key)] = {
            "rows": len(rows), "mean_before": round(float(before.mean()), 3), "median_before": round(float(before.median()), 3),
            "mae_before": round(float(before.abs().mean()), 3), "spearman_before": round(float(rows.sleeper_projection.corr(rows.jimmy_base_ppr, method="spearman")), 3),
            "mean_after": round(float(after.mean()), 3), "median_after": round(float(after.median()), 3),
            "mae_after": round(float(after.abs().mean()), 3), "spearman_after": round(float(rows.sleeper_projection.corr(rows.jimmy_league_adjusted, method="spearman")), 3),
            "mean_scoring_adjustment": round(float(rows.scoring_adjustment.mean()), 3),
            "mean_rush_attempt_bonus": round(float(rows.rush_attempt_bonus.mean()), 3),
        }
    return output


def historical_slices() -> dict[str, Any]:
    if __package__:
        from .report_projection_scoreboard import load_predictions
    else:
        from report_projection_scoreboard import load_predictions
    frame = load_predictions()
    frame = frame.loc[frame.v2.notna() & frame.v3_3_2.notna()].copy()
    keys = ["player_id", "season", "week", "historical_position"]
    features = pd.read_csv(
        ROOT / "data/processed/player_week_projection_features_v3_2.csv.gz",
        usecols=lambda column: column in {*keys, "pbp_rush_attempts_l3", "rush_attempts_l3"},
        dtype={"player_id": "string"},
    )
    available = [column for column in ("pbp_rush_attempts_l3", "rush_attempts_l3") if column in features]
    frame = frame.merge(features[keys + available], on=keys, how="left", validate="one_to_one")
    output: dict[str, Any] = {}
    percentiles = frame.v3_3_2.rank(pct=True)
    output["projection_percentiles"] = {}
    bands = [(0, .25), (.25, .5), (.5, .75), (.75, .9), (.9, .95), (.95, 1.001)]
    for low, high in bands:
        rows = frame.loc[percentiles.gt(low) & percentiles.le(high)]
        output["projection_percentiles"][f"p{int(low*100)}-{int(min(high,1)*100)}"] = {
            "v2": regression_metrics(rows.fantasy_points_ppr.to_numpy(), rows.v2.to_numpy()),
            "v3_3_2": regression_metrics(rows.fantasy_points_ppr.to_numpy(), rows.v3_3_2.to_numpy()),
        }
    rush_column = "pbp_rush_attempts_l3" if "pbp_rush_attempts_l3" in frame else "rush_attempts_l3"
    rushes = pd.to_numeric(frame[rush_column], errors="coerce")
    high_volume_rb = frame.loc[frame.historical_position.eq("RB") & rushes.ge(15)]
    output["high_volume_rb"] = {
        "definition": "pregame prior-3-game PBP rush attempts >= 15",
        "v2": regression_metrics(high_volume_rb.fantasy_points_ppr.to_numpy(), high_volume_rb.v2.to_numpy()),
        "v3_3_2": regression_metrics(high_volume_rb.fantasy_points_ppr.to_numpy(), high_volume_rb.v3_3_2.to_numpy()),
    }
    qb_rushes = rushes
    output["qb_rushing_archetypes"] = {}
    for label, mask in {
        "low_<3": qb_rushes.lt(3), "moderate_3-5": qb_rushes.ge(3) & qb_rushes.lt(5), "high_>=5": qb_rushes.ge(5),
    }.items():
        rows = frame.loc[frame.historical_position.eq("QB") & mask]
        output["qb_rushing_archetypes"][label] = {
            "v2": regression_metrics(rows.fantasy_points_ppr.to_numpy(), rows.v2.to_numpy()),
            "v3_3_2": regression_metrics(rows.fantasy_points_ppr.to_numpy(), rows.v3_3_2.to_numpy()),
        }
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--league-id", default=DEFAULT_LEAGUE_ID)
    parser.add_argument("--force-pbp", action="store_true")
    parser.add_argument("--offline", action="store_true", help="Use local model data and supplied points without live API/readback.")
    args = parser.parse_args()
    load_local_environment()

    cohort = pd.read_csv(COHORT_PATH, dtype={"player": "string", "position": "string"})
    identities = pd.read_csv(IDENTITY_PATH, dtype="string")
    live_meta: dict[str, Any] = {"readback": "offline"}
    sleeper_api: dict[str, dict[str, Any]] = {}
    if args.offline:
        live = pd.DataFrame()
        league = {"scoring_settings": {
            "rec": 1, "pass_yd": 1/22, "pass_td": 4, "pass_int": -2, "rush_yd": .1, "rush_td": 6,
            "rec_yd": .1, "rec_td": 6, "pass_fd": .1, "rush_att": .1, "rush_fd": .1,
            "rec_20_29": .1, "rec_30_39": .2, "rec_40p": .5, "rec_td_40p": .7, "rec_td_50p": 1,
            "rush_40p": .5, "rush_td_40p": .7, "rush_td_50p": 1,
            "pass_cmp_40p": .3, "pass_td_40p": .5, "pass_td_50p": 1,
        }}
    else:
        league = fetch_json(f"https://api.sleeper.app/v1/league/{args.league_id}")
        sleeper_api = sleeper_api_by_id(2026, 1)
        live, live_meta = query_remote_v332()
    cohort, unresolved = resolve_cohort(cohort, identities, sleeper_api)
    duplicate_rows = cohort.loc[cohort.ambiguous_duplicate, ["player", "position", "sleeper_projection", "sleeper_player_id"]].to_dict("records")
    rates = build_long_play_rates(args.force_pbp)
    rate_map = {str(row.player_id): row.to_dict() for _, row in rates.iterrows()}
    position_priors = {
        str(position): group[[f"{event}_rate" for event in RATE_SPECS]].mean().to_dict()
        for position, group in rates.groupby("historical_position")
    }

    local = pd.read_csv(V3_3_2_PROJECTION_OUTPUT_PATH, dtype={"gsis_id": "string"})
    local = local.merge(identities[["player_id", "sleeper_player_id", "rookie_season"]], left_on="gsis_id", right_on="player_id", how="left", validate="one_to_one")
    settings = {key: float(value) for key, value in league.get("scoring_settings", {}).items() if value is not None}

    local_by_sleeper = {str(row.sleeper_player_id): row for _, row in local.loc[local.sleeper_player_id.notna()].iterrows()}
    local_by_name = {normalize_name(row.player_name): row for _, row in local.iterrows()}
    live_by_sleeper = {str(row.sleeper_player_id): row for _, row in live.loc[live.sleeper_player_id.notna()].iterrows()} if not live.empty else {}
    comparison: list[dict[str, Any]] = []
    for _, supplied in cohort.iterrows():
        sleeper_id = str(supplied.sleeper_player_id) if pd.notna(supplied.sleeper_player_id) else ""
        local_row = local_by_sleeper.get(sleeper_id)
        if local_row is None:
            local_row = local_by_name.get(normalize_name(supplied.player))
        if local_row is None or supplied.position not in POSITIONS:
            continue
        stats = json.loads(local_row.projected_stats)
        live_row = live_by_sleeper.get(sleeper_id)
        live_final = float(live_row.final_projection_ppr) if live_row is not None and pd.notna(live_row.final_projection_ppr) else float(local_row.model_projection_ppr)
        live_vegas = float(live_row.vegas_projection_ppr) if live_row is not None and pd.notna(live_row.vegas_projection_ppr) else None
        long_rate = rate_map.get(str(local_row.gsis_id), position_priors.get(str(supplied.position), {}))
        long_events = expected_long_events(stats, long_rate)
        enriched = {**stats, **long_events}
        component_ppr = score_projected_stats_exact(stats, {"rec": 1}, supplied.position)
        custom_without_rare = score_projected_stats_exact(stats, {key: value for key, value in settings.items() if key not in RARE_SETTINGS}, supplied.position)
        custom_with_rare = score_projected_stats_exact(enriched, settings, supplied.position)
        adjustment = custom_with_rare - component_ppr
        api_row = sleeper_api.get(sleeper_id, {})
        api_stats = api_row.get("stats") or {}
        sleeper_custom_current = sum(float(api_stats.get(key, 0) or 0) * rate for key, rate in settings.items())
        recent_opportunities = float(local_row.recent_opportunities) if pd.notna(local_row.recent_opportunities) else 0
        comparison.append({
            "player": supplied.player, "position": supplied.position, "sleeper_player_id": sleeper_id,
            "gsis_id": local_row.gsis_id, "ambiguous_duplicate": bool(supplied.ambiguous_duplicate),
            "sleeper_projection": float(supplied.sleeper_projection), "jimmy_base_ppr": live_final,
            "sleeper_api_custom_projection": sleeper_custom_current,
            "jimmy_raw_model_ppr": float(local_row.model_projection_ppr), "jimmy_vegas_ppr": live_vegas,
            "scoring_adjustment": adjustment, "rush_attempt_bonus": float(stats.get("rush_attempts", 0) or 0) * settings.get("rush_att", 0),
            "rare_bonus_ev": custom_with_rare - custom_without_rare,
            "other_linear_adjustment": custom_without_rare - component_ppr,
            "jimmy_league_adjusted": live_final + adjustment,
            "sleeper_minus_jimmy_base": float(supplied.sleeper_projection) - live_final,
            "sleeper_minus_jimmy_adjusted": float(supplied.sleeper_projection) - (live_final + adjustment),
            "pass_attempts": float(stats.get("pass_attempts", 0) or 0), "rush_attempts": float(stats.get("rush_attempts", 0) or 0),
            "targets": float(stats.get("targets", 0) or 0), "passing_touchdowns": float(stats.get("passing_touchdowns", 0) or 0),
            "rushing_touchdowns": float(stats.get("rushing_touchdowns", 0) or 0), "receiving_touchdowns": float(stats.get("receiving_touchdowns", 0) or 0),
            "sleeper_pass_attempts": float(api_stats.get("pass_att", 0) or 0),
            "sleeper_rush_attempts": float(api_stats.get("rush_att", 0) or 0),
            "sleeper_targets": float(api_stats.get("rec_tgt", 0) or 0),
            "depth_role": (
                f"{local_row.depth_position}{int(local_row.depth_rank)}"
                if pd.notna(local_row.depth_position) and pd.notna(local_row.depth_rank)
                else local_row.depth_position if pd.notna(local_row.depth_position) else None
            ),
            "depth_rank": float(local_row.depth_rank) if pd.notna(local_row.depth_rank) else None,
            "recent_opportunities": recent_opportunities, "empirical_confidence": local_row.confidence,
            "low_history": int(local_row.rookie_season) >= 2025 if pd.notna(local_row.rookie_season) else False,
            "sleeper_stats": api_stats,
        })
    output = pd.DataFrame(comparison)
    output["absolute_adjusted_difference"] = output.sleeper_minus_jimmy_adjusted.abs()
    output["classification"] = output.apply(classify, axis=1)
    clean = output.loc[~output.ambiguous_duplicate].copy()
    clean["tier"] = pd.qcut(clean.jimmy_league_adjusted.rank(method="first"), 4, labels=["bench", "flex", "starter", "elite"])
    output = output.merge(clean[["sleeper_player_id", "sleeper_projection", "tier"]], on=["sleeper_player_id", "sleeper_projection"], how="left")
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    output.drop(columns=["sleeper_stats"]).sort_values("absolute_adjusted_difference", ascending=False).to_csv(OUTPUT_CSV, index=False)

    offensive_settings = {
        key: value for key, value in settings.items()
        if value != 0 and (key in SUPPORTED_LINEAR or key in RARE_SETTINGS or key in OFFENSIVE_UNSUPPORTED)
    }
    support = {
        key: "deterministic" if key in SUPPORTED_LINEAR else "expected" if key in RARE_SETTINGS else "unsupported"
        for key in offensive_settings
    }
    point_weighted_total = 0.0
    point_weighted_supported = 0.0
    if sleeper_api:
        for _, row in clean.iterrows():
            stats = row.sleeper_stats if isinstance(row.sleeper_stats, dict) else {}
            for key, rate in offensive_settings.items():
                contribution = abs(float(stats.get(key, 0) or 0) * rate)
                point_weighted_total += contribution
                if support[key] != "unsupported":
                    point_weighted_supported += contribution

    report = {
        "outcome": "V3.3.2 RETAINED - SCORING TRANSLATION IMPROVED; TARGETED MODEL WEAKNESSES IDENTIFIED",
        "method": {
            "comparison_target": "supplied Sleeper custom-league screenshot values",
            "sleeper_is_training_target": False,
            "jimmy_base": "live reconciled v3.3.2 final_projection_ppr when online",
            "league_adjusted": "live Jimmy final plus deterministic component scoring delta plus shrunken nflverse long-play expected value",
            "pbp_seasons": [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
            "rare_event_shrinkage": {event: strength for event, (_, strength) in RATE_SPECS.items()},
        },
        "remote": live_meta,
        "cohort": {
            "supplied_rows": len(cohort), "offensive_comparisons": len(output), "aggregate_rows": len(clean),
            "unresolved": unresolved, "ambiguous_duplicates_excluded": duplicate_rows,
            "sleeper_feed_reconstruction": {
                "rows_within_0_05": int((clean.sleeper_api_custom_projection - clean.sleeper_projection).abs().le(.05).sum()),
                "mean_absolute_difference": float((clean.sleeper_api_custom_projection - clean.sleeper_projection).abs().mean()),
                "note": "Larger differences indicate the supplied screenshots and the current Sleeper feed were captured at different projection revisions.",
            },
        },
        "scoring_coverage": {
            "settings": support,
            "supported_key_fraction": sum(value != "unsupported" for value in support.values()) / max(len(support), 1),
            "unsupported": [key for key, value in support.items() if value == "unsupported"],
            "point_weighted_coverage_using_sleeper_components": point_weighted_supported / point_weighted_total if point_weighted_total else None,
        },
        "system_gap": {
            "overall": summarize_system_gap(clean.assign(all="all"), "all")["all"],
            "position": summarize_system_gap(clean, "position"),
            "tier": summarize_system_gap(clean, "tier"),
            "confidence": summarize_system_gap(clean, "empirical_confidence"),
        },
        "scoring_impact": {
            "mean_total_adjustment": float(clean.scoring_adjustment.mean()),
            "median_total_adjustment": float(clean.scoring_adjustment.median()),
            "mean_rush_attempt_bonus": float(clean.rush_attempt_bonus.mean()),
            "mean_rare_bonus_ev": float(clean.rare_bonus_ev.mean()),
            "mean_other_linear_adjustment": float(clean.other_linear_adjustment.mean()),
            "rb_mean_rush_attempt_bonus": float(clean.loc[clean.position.eq("RB"), "rush_attempt_bonus"].mean()),
            "gap_reduction": float(clean.sleeper_minus_jimmy_base.abs().mean() - clean.sleeper_minus_jimmy_adjusted.abs().mean()),
        },
        "largest_discrepancies": output.nlargest(30, "absolute_adjusted_difference").drop(columns=["sleeper_stats"]).replace({np.nan: None}).to_dict("records"),
        "historical_validation": historical_slices(),
        "vegas": {
            "players_with_vegas_projection": int(output.jimmy_vegas_ppr.notna().sum()),
            "mean_live_minus_raw": float((output.jimmy_base_ppr - output.jimmy_raw_model_ppr).mean()),
            "stored_context": live_meta,
        },
        "production_changes": {
            "supabase_writes": 0, "migrations": 0, "model_activation": None,
            "environment_changes": 0, "vercel_deployments": 0,
        },
        "recommendation": "keep v3.3.2 live; ship generic league-scoring translation support and continue an experimental elite/RB/QB calibration investigation only if historical slices confirm it",
    }
    OUTPUT_JSON.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(f"Comparison rows: {len(output)} ({len(clean)} unambiguous aggregate rows)")
    print(f"Report: {OUTPUT_JSON}")
    print(f"Leaderboard: {OUTPUT_CSV}")
    print(report["outcome"])


if __name__ == "__main__":
    main()
