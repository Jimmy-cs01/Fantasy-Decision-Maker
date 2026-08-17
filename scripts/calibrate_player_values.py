#!/usr/bin/env python3
"""Sanity-check the shared Player Value scale against current and historical data.

This is a reporting tool, not a second production value service. It reads the
same source-controlled calibration fixture as the TypeScript service and writes
only an ignored diagnostic report.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

if __package__:
    from .projection_pipeline.scoring import default_scores
else:
    from projection_pipeline.scoring import default_scores

ROOT = Path(__file__).resolve().parents[1]
CALIBRATION_PATH = ROOT / "lib/player-values/calibration.json"
PROJECTIONS_PATH = ROOT / "data/processed/player_projections.csv"
IDENTITY_PATH = ROOT / "data/processed/player_identity.csv"
HISTORICAL_PATH = ROOT / "data/processed/historical_weekly_player_stats.csv"
OUTPUT_PATH = ROOT / "data/processed/player_value_calibration_report.json"
DEPTH_PATH = ROOT / "data/processed/depth_chart_roles.csv"
DRAFT_PATH = ROOT / "data/processed/player_draft_capital.csv"
POSITIONS = ("QB", "RB", "WR", "TE")


def slot_eligibility(slot: str) -> tuple[str, ...]:
    normalized = slot.strip().upper().replace(" ", "_")
    if normalized in POSITIONS:
        return (normalized,)
    if normalized in {"SUPER_FLEX", "SUPERFLEX", "OP"}:
        return POSITIONS
    if normalized in {"REC_FLEX", "WR_TE_FLEX"}:
        return ("WR", "TE")
    if normalized in {"WRRB_FLEX", "WR_RB_FLEX"}:
        return ("RB", "WR")
    if normalized in {"FLEX", "WRT", "WRRBTE_FLEX"}:
        return ("RB", "WR", "TE")
    return ()


def profiles(frame: pd.DataFrame, teams: int, roster_positions: list[str]) -> dict[str, dict[str, float]]:
    demand = {position: 0 for position in POSITIONS}
    flexible: list[tuple[str, ...]] = []
    for slot in roster_positions:
        eligible = slot_eligibility(slot)
        if len(eligible) == 1:
            demand[eligible[0]] += teams
        elif eligible:
            flexible.extend([eligible] * teams)
    used: set[str] = set()
    for position in POSITIONS:
        selected = frame[frame.position.eq(position)].sort_values(["ppg", "player_id"], ascending=[False, True]).head(demand[position])
        used.update(selected.player_id)
    for eligible in sorted(flexible, key=lambda item: (len(item), item)):
        candidate = frame[frame.position.isin(eligible) & ~frame.player_id.isin(used)].sort_values(["ppg", "player_id"], ascending=[False, True]).head(1)
        if candidate.empty:
            continue
        row = candidate.iloc[0]
        used.add(row.player_id)
        demand[row.position] += 1
    bench_slots = sum(slot.strip().upper() in {"BN", "BENCH"} for slot in roster_positions)
    bench_demand = bench_slots * teams
    starter_total = max(1, sum(demand.values()))
    quotas = {position: bench_demand * demand[position] / starter_total for position in POSITIONS}
    allocations = {position: int(np.floor(quota)) for position, quota in quotas.items()}
    remaining = bench_demand - sum(allocations.values())
    for position in sorted(POSITIONS, key=lambda item: (-(quotas[item] - allocations[item]), item))[:remaining]:
        allocations[position] += 1
    for position in POSITIONS:
        demand[position] += allocations[position]
    output = {}
    for position in POSITIONS:
        players = frame[frame.position.eq(position)].sort_values(["ppg", "player_id"], ascending=[False, True]).reset_index(drop=True)
        requested = demand[position]
        at = lambda index: float(players.iloc[min(max(index, 0), len(players) - 1)].ppg) if len(players) else 0.0
        elite_count = max(1, int(np.ceil(teams * 0.2)))
        elite = float(players.head(elite_count).ppg.mean()) if len(players) else 0.0
        replacement = at(requested)
        output[position] = {
            "demand": requested,
            "replacement": replacement,
            "starter": at(int(np.ceil(requested / 2)) - 1),
            "elite": elite,
            "scarcity": max(0.0, elite - replacement),
        }
    return output


def raw_value(row: pd.Series, profile: dict[str, float], games: float, calibration: dict) -> tuple[float, float, float]:
    weights = calibration["weights"]
    vorp = float(row.ppg) - profile["replacement"]
    ros_vorp = vorp * games
    floor_vorp = max(0.0, float(row.floor) - profile["replacement"]) * games
    upside = max(0.0, float(row.ceiling) - float(row.ppg)) * games
    denominator = max(0.01, profile["elite"] - profile["starter"])
    elite_share = min(1.0, max(0.0, (float(row.ppg) - profile["starter"]) / denominator))
    scarcity = profile["scarcity"] * games * elite_share
    confidence = weights["confidence"][str(row.confidence).lower()]
    raw = (ros_vorp + weights["floorVorp"] * floor_vorp + weights["upside"] * upside + weights["scarcity"] * scarcity) * confidence
    return raw, vorp, ros_vorp


def value(raw: float, calibration: dict) -> float:
    display = calibration["displayCalibration"]
    softplus = lambda item: item if item > 30 else np.exp(item) if item < -30 else np.log1p(np.exp(item))
    reference = softplus(display["referenceRawValue"] / display["temperature"])
    base = display["referenceDisplayValue"] * softplus(raw / display["temperature"]) / reference
    if base <= display["softTailStart"]:
        return round(max(0.0, base), 1)
    tail = display["softTailStart"] + (display["softTailLimit"] - display["softTailStart"]) * (1 - np.exp(-(base - display["softTailStart"]) / display["softTailRate"]))
    return round(float(tail), 1)


def tier(amount: float) -> str:
    thresholds = [(50, "Generational / Historic"), (45, "Elite Cornerstone"), (38, "Elite Fantasy Asset"), (30, "High-End Starter"), (24, "Strong Starter"), (18, "Solid Starter"), (12, "FLEX / Lower Starter"), (7, "Useful Depth"), (3, "Bench Value"), (1, "Fringe Roster")]
    return next((label for threshold, label in thresholds if amount >= threshold), "Replacement / Waiver")


def opportunity_context(row: pd.Series, profile: dict[str, float], games: float, calibration: dict, production_raw: float) -> tuple[float, dict]:
    status = row.get("draft_status")
    round_number = int(row.draft_round) if pd.notna(row.get("draft_round")) else None
    position = str(row.position)
    if pd.isna(status):
        draft_confidence = 1.0
    elif status == "unknown":
        draft_confidence = 0.55
    elif status == "undrafted":
        draft_confidence = 0.1 if position == "TE" else 0.08 if position == "QB" else 0.07
    elif not round_number:
        draft_confidence = 0.7
    else:
        curves = {
            "QB": [1, .72, .55, .42, .32, .24, .18],
            "RB": [1, .9, .76, .55, .4, .28, .18],
            "WR": [1, .85, .7, .52, .38, .25, .16],
            "TE": [.95, .85, .74, .6, .45, .32, .22],
        }
        draft_confidence = curves[position][min(7, max(1, round_number)) - 1]
    rank = int(row.depth_rank) if pd.notna(row.get("depth_rank")) else None
    if not rank:
        depth_factor = 1.0
    elif position == "QB":
        depth_factor = 1.0 if rank == 1 else max(.08, .32 / (rank - 1)) if profile["demand"] / 10 >= 1.5 else max(.02, .09 / (rank - 1))
    else:
        curves = {"RB": [1, .72, .32, .1, .05, .03], "WR": [.98, .9, .76, .42, .2, .1], "TE": [1, .65, .35, .18, .1, .06]}
        depth_factor = curves[position][min(6, rank) - 1]
    established = min(1.0, max(0.0, float(row.get("count", 0) if pd.notna(row.get("count", 0)) else 0) / 24))
    speculative = .03 + .97 * draft_confidence * depth_factor
    opportunity = min(1.0, max(.03, established + (1 - established) * speculative))
    opportunity_cost = (1 - opportunity) * profile["replacement"] * games * calibration["weights"]["opportunityCost"]
    adjusted = production_raw * opportunity - opportunity_cost if production_raw > 0 else production_raw
    if position == "RB":
        depth_context = .22 if rank == 1 else .15 if rank == 2 else max(-1, -.35 * (rank - 2)) if rank else 0
    elif position == "WR": depth_context = .12 if rank and rank <= 3 else max(-.4, -.08 * (rank - 3)) if rank else 0
    elif position == "TE": depth_context = .15 if rank == 1 else 0 if rank == 2 or not rank else max(-.35, -.1 * (rank - 2))
    else: depth_context = .18 if rank == 1 else max(-.5, -.2 * (rank - 1)) if rank and profile["demand"] / 10 >= 1.5 else max(-1.25, -.8 * (rank - 1)) if rank else 0
    draft_context = 0.0
    if status == "undrafted": draft_context = -.22
    elif status == "drafted" and round_number: draft_context = .18 if round_number == 1 else .12 if round_number == 2 else .06 if round_number == 3 else -.1 if round_number >= 6 else 0
    draft_context *= 1 - established
    return adjusted + games * (depth_context + draft_context), {"opportunity_confidence": opportunity, "draft_context": draft_context, "role_context": depth_context}


def current_report(calibration: dict, identities: pd.DataFrame, projections_path: Path = PROJECTIONS_PATH, roster_positions: list[str] | None = None, teams: int | None = None) -> tuple[pd.DataFrame, dict]:
    frame = pd.read_csv(projections_path, dtype={"gsis_id": "string"})
    frame["player_id"] = frame.gsis_id
    frame["position"] = frame.position.str.upper()
    frame["ppg"] = frame.apply(lambda row: default_scores(json.loads(row.projected_stats), row.position)["half_ppr"], axis=1)
    frame["floor"] = (frame.ppg + frame.residual_low).clip(lower=0)
    frame["ceiling"] = (frame.ppg + frame.residual_high).clip(lower=0)
    prior = pd.read_csv(
        HISTORICAL_PATH,
        usecols=["player_id", "season", "season_type", "fantasy_points_half_ppr"],
        dtype={"player_id": "string"},
    )
    projection_season = int(frame.season.max())
    prior = prior[
        prior.season.between(projection_season - 3, projection_season - 1)
        & prior.season_type.eq("REG")
    ]
    prior = prior.groupby(["player_id", "season"]).fantasy_points_half_ppr.agg(["sum", "count"]).reset_index()
    prior["season_ppg"] = prior["sum"] / prior["count"]
    season_weights = calibration["earlySeasonPrior"]["recentSeasonWeights"]
    prior["weight"] = prior.season.map(
        lambda season: season_weights[projection_season - int(season) - 1]
    )
    prior["weighted_ppg"] = prior["season_ppg"] * prior["weight"]
    prior = prior.groupby("player_id").agg(
        weighted_ppg=("weighted_ppg", "sum"),
        weight=("weight", "sum"),
        count=("count", "sum"),
    ).reset_index()
    prior["prior_ppg"] = prior["weighted_ppg"] / prior["weight"]
    frame = frame.merge(prior[["player_id", "prior_ppg", "count"]], on="player_id", how="left")
    prior_config = calibration["earlySeasonPrior"]
    frame["prior_weight"] = np.where(
        frame["count"].fillna(0).ge(prior_config["minimumPriorGames"]),
        prior_config["preseasonWeight"],
        0.0,
    )
    shift = frame["prior_weight"] * (frame["prior_ppg"].fillna(frame["ppg"]) - frame["ppg"])
    frame["ppg"] += shift
    frame["floor"] = (frame["floor"] + shift).clip(lower=0)
    frame["ceiling"] = (frame["ceiling"] + shift).clip(lower=0)
    frame["confidence"] = frame.confidence.str.lower()
    frame = frame.merge(identities[["player_id", "player_name"]], on="player_id", how="left")
    if DRAFT_PATH.exists():
        draft = pd.read_csv(DRAFT_PATH, usecols=["gsis_id", "draft_round", "draft_pick", "draft_status"], dtype={"gsis_id": "string"})
        frame = frame.merge(draft, left_on="player_id", right_on="gsis_id", how="left")
    if DEPTH_PATH.exists():
        depth = pd.read_csv(DEPTH_PATH, usecols=["gsis_id", "depth_position", "depth_rank"], dtype={"gsis_id": "string"})
        frame = frame.merge(depth, left_on="player_id", right_on="gsis_id", how="left", suffixes=("", "_depth"))
    default = calibration["defaultLeague"]
    teams = teams or default["teams"]
    roster_positions = roster_positions or default["rosterPositions"]
    replacement = profiles(frame, teams, roster_positions)
    rows = []
    for _, row in frame.iterrows():
        raw, vorp, ros = raw_value(row, replacement[row.position], 17, calibration)
        adjusted_raw, context = opportunity_context(row, replacement[row.position], 17, calibration, raw)
        amount = value(adjusted_raw, calibration)
        rows.append({"player_id": row.player_id, "name": row.player_name, "position": row.position, "ppg": round(row.ppg, 1), "prior_ppg": round(row.prior_ppg, 1) if pd.notna(row.prior_ppg) else None, "prior_weight": round(row.prior_weight, 3), "floor_ppg": round(row.floor, 1), "ceiling_ppg": round(row.ceiling, 1), "replacement_ppg": round(replacement[row.position]["replacement"], 1), "vorp_per_game": round(vorp, 1), "ros_vorp": round(ros, 1), "raw_value": round(adjusted_raw, 3), "value": amount, "tier": tier(amount), "draft_status": row.get("draft_status"), "draft_round": int(row.draft_round) if pd.notna(row.get("draft_round")) else None, **context})
    result = pd.DataFrame(rows).sort_values(
        ["value", "ppg", "player_id"], ascending=[False, False, True]
    ).reset_index(drop=True)
    result["overall_rank"] = np.arange(1, len(result) + 1)
    result["position_rank"] = result.groupby("position").cumcount() + 1
    return result, replacement


def historical_report(calibration: dict, identities: pd.DataFrame) -> tuple[list[dict], pd.DataFrame]:
    usecols = ["player_id", "season", "week", "season_type", "historical_position", "fantasy_points_half_ppr"]
    weekly = pd.read_csv(HISTORICAL_PATH, usecols=usecols, dtype={"player_id": "string"})
    weekly = weekly[weekly.season_type.eq("REG") & weekly.historical_position.isin(POSITIONS)]
    grouped = weekly.groupby(["player_id", "season", "historical_position"])
    seasons = grouped.agg(points=("fantasy_points_half_ppr", "sum"), games=("week", "count"), floor=("fantasy_points_half_ppr", lambda values: values.quantile(0.2)), ceiling=("fantasy_points_half_ppr", lambda values: values.quantile(0.8))).reset_index()
    seasons["ppg"] = seasons.points / seasons.games
    seasons["position"] = seasons.historical_position
    seasons["confidence"] = "high"
    seasons = seasons.merge(identities[["player_id", "player_name"]], on="player_id", how="left")
    results = []
    default = calibration["defaultLeague"]
    for season, season_frame in seasons.groupby("season"):
        eligible = season_frame[season_frame.games.ge(4)]
        replacement = profiles(eligible, default["teams"], default["rosterPositions"])
        for _, row in eligible.iterrows():
            raw, _, _ = raw_value(row, replacement[row.position], float(row.games), calibration)
            results.append({"player_id": row.player_id, "name": row.player_name, "position": row.position, "season": int(season), "ppg": round(row.ppg, 1), "value": value(raw, calibration)})
    historical = pd.DataFrame(results)
    examples = [historical[historical.position.eq(position)].sort_values(["value", "ppg"], ascending=False).iloc[0].to_dict() for position in POSITIONS]
    return examples, historical


def depth_context_examples(current: pd.DataFrame, calibration: dict) -> list[dict]:
    if "depth_rank" not in current:
        return []
    candidates = pd.concat([
        current[current.depth_rank.eq(1)].head(1),
        current[current.depth_rank.eq(2)].head(1),
        current[current.depth_rank.ge(3)].head(1),
    ]).drop_duplicates("player_id")
    return candidates[["name", "position", "depth_position", "depth_rank", "value", "opportunity_confidence", "draft_context", "role_context"]].to_dict("records")


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate and report the shared Player Value scale.")
    parser.add_argument("--projections", type=Path, default=PROJECTIONS_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    calibration = json.loads(CALIBRATION_PATH.read_text())
    identities = pd.read_csv(IDENTITY_PATH, usecols=["player_id", "player_name"], dtype={"player_id": "string"})
    current, replacement = current_report(calibration, identities, args.projections)
    superflex, superflex_replacement = current_report(calibration, identities, args.projections, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN", "BN", "BN", "BN", "BN"], 12)
    historical, historical_rows = historical_report(calibration, identities)
    cmc_rows = historical_rows[(historical_rows.player_id.eq("00-0033280")) & (historical_rows.season.eq(2019))]
    cmc_value = float(cmc_rows.iloc[0].value) if not cmc_rows.empty else None
    top_qb = current[current.position.eq("QB")].iloc[0]
    superflex_qb = superflex[superflex.player_id.eq(top_qb.player_id)].iloc[0]
    latest_historical = historical_rows[historical_rows.season.eq(historical_rows.season.max())]
    representative = []
    for position, ranks in {"QB": [1, 11], "RB": [5, 18, 32], "WR": [5, 18, 30], "TE": [1, 10]}.items():
        ordered = latest_historical[latest_historical.position.eq(position)].sort_values(
            ["value", "ppg"], ascending=False
        ).reset_index(drop=True)
        for rank in ranks:
            if len(ordered) >= rank:
                row = ordered.iloc[rank - 1].to_dict()
                row["position_rank"] = rank
                representative.append(row)
    report = {
        "calibration_reference_raw_value": calibration["displayCalibration"]["referenceRawValue"],
        "cmc_2019_value": cmc_value,
        "distribution": {
            "min": float(current.value.min()), "median": float(current.value.median()),
            "p75": float(current.value.quantile(.75)), "p90": float(current.value.quantile(.90)),
            "p95": float(current.value.quantile(.95)), "max": float(current.value.max()),
            "exactly_zero": int(current.value.eq(0).sum()), "above_40": int(current.value.gt(40).sum()),
            "above_50": int(current.value.gt(50).sum()),
        },
        "draft_coverage": {
            "fantasy_players": int(len(pd.read_csv(DRAFT_PATH).query("position in ['QB', 'RB', 'WR', 'TE']"))) if DRAFT_PATH.exists() else 0,
            "known_drafted_or_udfa": int(pd.read_csv(DRAFT_PATH).query("position in ['QB', 'RB', 'WR', 'TE']").draft_status.isin(["drafted", "undrafted"]).sum()) if DRAFT_PATH.exists() else 0,
            "current_projection_players": int(len(current)),
            "current_projection_known": int(current.draft_status.isin(["drafted", "undrafted"]).sum()),
        },
        "frank_gore_jr": current[current.player_id.eq("00-0039471")].head(1).to_dict("records"),
        "current_top_20": current.head(20).to_dict("records"),
        "current_tier_counts": current.tier.value_counts().to_dict(),
        "current_sanity_samples": {
            "elite": current[current.value.ge(38)].head(10).to_dict("records"),
            "starters": current[current.value.between(18, 37.9)].head(20).to_dict("records"),
            "flex_mid_tier": current[current.value.between(10, 17.9)].head(20).to_dict("records"),
            "bench_depth": current[current.value.between(1, 9.9)].head(20).to_dict("records"),
            "replacement": current[current.value.lt(1)].head(20).to_dict("records"),
        },
        "diagnostic_players": current[current.name.isin(["Travis Etienne", "Breece Hall"])].to_dict("records"),
        "depth_context_examples": depth_context_examples(current, calibration),
        "default_replacement": replacement,
        "historical_examples": historical,
        "historical_representative_2025": representative,
        "qb_superflex_example": {"name": top_qb["name"], "one_qb_value": top_qb["value"], "superflex_value": superflex_qb["value"], "one_qb_replacement": replacement["QB"]["replacement"], "superflex_replacement": superflex_replacement["QB"]["replacement"]},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"CMC 2019 sanity check: {report['cmc_2019_value']:.1f} (not hardcoded)")
    print("Distribution:", report["distribution"])
    print("Current top values:")
    for row in report["current_top_20"][:10]:
        print(f"  {row['name']} ({row['position']}): {row['value']:.1f} · {row['ppg']:.1f} PPG")
    print("Historical position examples:")
    for row in historical:
        print(f"  {row['season']} {row['name']} ({row['position']}): {row['value']:.1f} · {row['ppg']:.1f} PPG")
    sf = report["qb_superflex_example"]
    print(f"QB format check — {sf['name']}: {sf['one_qb_value']:.1f} in default 1QB, {sf['superflex_value']:.1f} in 12-team Superflex")
    print("Diagnostic players:")
    for row in report["diagnostic_players"]:
        print(f"  {row['name']}: {row['value']:.1f} ({row['tier']}); {row['ppg']:.1f} stabilized PPG; prior {row['prior_ppg']}")
    print(f"Report: {args.output}")


if __name__ == "__main__":
    main()
