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
    raw = max(0.0, (ros_vorp + weights["floorVorp"] * floor_vorp + weights["upside"] * upside + weights["scarcity"] * scarcity) * confidence)
    return raw, vorp, ros_vorp


def cmc_raw(calibration: dict) -> float:
    cmc = calibration["cmc2019"]
    row = pd.Series({"ppg": cmc["medianPpg"], "floor": cmc["floorPpg"], "ceiling": cmc["ceilingPpg"], "confidence": cmc["confidence"]})
    profile = {"replacement": cmc["replacementPpg"], "starter": cmc["starterPpg"], "elite": cmc["elitePpg"], "scarcity": cmc["elitePpg"] - cmc["replacementPpg"]}
    return raw_value(row, profile, cmc["games"], calibration)[0]


def value(raw: float, benchmark: float, anchor: bool = False, exponent: float = 0.4) -> float:
    if anchor:
        return 100.0
    ratio = min(1.0, max(0.0, raw / benchmark))
    return round(min(99.9, 100 * ratio ** exponent), 1)


def tier(amount: float) -> str:
    thresholds = [(95, "Historic / League-Breaking"), (90, "Elite Cornerstone"), (80, "Elite Fantasy Asset"), (70, "High-End Starter"), (60, "Strong Starter"), (50, "Solid Starter"), (40, "FLEX / Lower Starter"), (30, "Useful Depth"), (20, "Bench Value"), (10, "Fringe Roster")]
    return next((label for threshold, label in thresholds if amount >= threshold), "Replacement / Waiver")


def current_report(calibration: dict, identities: pd.DataFrame, benchmark: float, projections_path: Path = PROJECTIONS_PATH, roster_positions: list[str] | None = None, teams: int | None = None) -> tuple[pd.DataFrame, dict]:
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
    default = calibration["defaultLeague"]
    teams = teams or default["teams"]
    roster_positions = roster_positions or default["rosterPositions"]
    replacement = profiles(frame, teams, roster_positions)
    rows = []
    for _, row in frame.iterrows():
        raw, vorp, ros = raw_value(row, replacement[row.position], 17, calibration)
        amount = value(raw, benchmark, exponent=calibration["displayCalibration"]["exponent"])
        rows.append({"player_id": row.player_id, "name": row.player_name, "position": row.position, "ppg": round(row.ppg, 1), "prior_ppg": round(row.prior_ppg, 1) if pd.notna(row.prior_ppg) else None, "prior_weight": round(row.prior_weight, 3), "floor_ppg": round(row.floor, 1), "ceiling_ppg": round(row.ceiling, 1), "replacement_ppg": round(replacement[row.position]["replacement"], 1), "vorp_per_game": round(vorp, 1), "ros_vorp": round(ros, 1), "value": amount, "tier": tier(amount)})
    result = pd.DataFrame(rows).sort_values(
        ["value", "ppg", "player_id"], ascending=[False, False, True]
    ).reset_index(drop=True)
    result["overall_rank"] = np.arange(1, len(result) + 1)
    result["position_rank"] = result.groupby("position").cumcount() + 1
    return result, replacement


def historical_report(calibration: dict, identities: pd.DataFrame, benchmark: float) -> tuple[list[dict], dict, pd.DataFrame]:
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
    cmc_profile = None
    for season, season_frame in seasons.groupby("season"):
        eligible = season_frame[season_frame.games.ge(4)]
        replacement = profiles(eligible, default["teams"], default["rosterPositions"])
        if season == calibration["cmc2019"]["season"]:
            cmc_profile = replacement["RB"]
        for _, row in eligible.iterrows():
            raw, _, _ = raw_value(row, replacement[row.position], float(row.games), calibration)
            anchor = row.player_id == calibration["cmc2019"]["playerId"] and season == calibration["cmc2019"]["season"]
            results.append({"player_id": row.player_id, "name": row.player_name, "position": row.position, "season": int(season), "ppg": round(row.ppg, 1), "value": value(raw, benchmark, anchor, calibration["displayCalibration"]["exponent"])})
    historical = pd.DataFrame(results)
    examples = [historical[historical.position.eq(position)].sort_values(["value", "ppg"], ascending=False).iloc[0].to_dict() for position in POSITIONS]
    return examples, cmc_profile or {}, historical


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate and report the shared Player Value scale.")
    parser.add_argument("--projections", type=Path, default=PROJECTIONS_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    calibration = json.loads(CALIBRATION_PATH.read_text())
    identities = pd.read_csv(IDENTITY_PATH, usecols=["player_id", "player_name"], dtype={"player_id": "string"})
    benchmark = cmc_raw(calibration)
    current, replacement = current_report(calibration, identities, benchmark, args.projections)
    superflex, superflex_replacement = current_report(calibration, identities, benchmark, args.projections, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"], 12)
    historical, cmc_profile, historical_rows = historical_report(calibration, identities, benchmark)
    expected = calibration["cmc2019"]
    for key, fixture_key in [("replacement", "replacementPpg"), ("starter", "starterPpg"), ("elite", "elitePpg")]:
        if not np.isclose(cmc_profile[key], expected[fixture_key], atol=0.001):
            raise ValueError(f"CMC calibration drifted for {key}: {cmc_profile[key]} vs {expected[fixture_key]}")
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
        "benchmark_raw_value": round(benchmark, 4),
        "cmc_2019_value": 100.0,
        "current_top_20": current.head(20).to_dict("records"),
        "current_tier_counts": current.tier.value_counts().to_dict(),
        "current_sanity_samples": {
            "elite": current[current.value.ge(70)].head(10).to_dict("records"),
            "starters": current[current.value.between(50, 69.9)].head(20).to_dict("records"),
            "flex_mid_tier": current[current.value.between(35, 49.9)].head(20).to_dict("records"),
            "bench_depth": current[current.value.between(10, 34.9)].head(20).to_dict("records"),
            "replacement": current[current.value.lt(10)].head(20).to_dict("records"),
        },
        "diagnostic_players": current[current.name.isin(["Travis Etienne", "Breece Hall"])].to_dict("records"),
        "default_replacement": replacement,
        "historical_examples": historical,
        "historical_representative_2025": representative,
        "qb_superflex_example": {"name": top_qb["name"], "one_qb_value": top_qb["value"], "superflex_value": superflex_qb["value"], "one_qb_replacement": replacement["QB"]["replacement"], "superflex_replacement": superflex_replacement["QB"]["replacement"]},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"CMC 2019 anchor: {report['cmc_2019_value']:.1f}; raw benchmark: {report['benchmark_raw_value']:.3f}")
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
