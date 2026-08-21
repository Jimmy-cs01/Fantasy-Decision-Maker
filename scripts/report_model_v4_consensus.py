#!/usr/bin/env python3
"""Build the frozen v4 consensus candidate report without production writes."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from projection_pipeline.v4_consensus import adaptive_consensus_weight, apply_v4_historical_safety
from projection_pipeline.evaluation_scoreboard import chronological_quantile_calibration, role_change_report

ROOT = Path(__file__).resolve().parents[1]
OOF = ROOT / "data/processed/model_v4_oof.csv.gz"
CURRENT_V3 = ROOT / "data/processed/player_projections_v3_3_2.csv"
CURRENT_V4 = ROOT / "data/processed/player_projections_v4_candidate.csv"
SLEEPER = ROOT / "data/processed/v3_3_2_sleeper_week1_comparison.csv"
HISTORY = ROOT / "data/processed/historical_weekly_player_stats.csv"
OUTPUT = ROOT / "data/processed/model_v4_consensus_report.json"
CURRENT_OUTPUT = ROOT / "data/processed/player_projections_v4_consensus_candidate.csv"


def metrics(actual, predicted):
    actual, predicted = np.asarray(actual, float), np.asarray(predicted, float)
    error = predicted - actual
    return {
        "rows": len(actual), "mae": round(float(np.abs(error).mean()), 4),
        "rmse": round(float(np.sqrt(np.square(error).mean())), 4),
        "median_absolute_error": round(float(np.median(np.abs(error))), 4),
        "bias": round(float(error.mean()), 4),
        "pearson": round(float(np.corrcoef(actual, predicted)[0, 1]), 4),
        "spearman": round(float(pd.Series(actual).corr(pd.Series(predicted), method="spearman")), 4),
        "r2": round(float(1 - np.square(error).sum() / np.square(actual - actual.mean()).sum()), 4),
        "gt5": round(float((np.abs(error) > 5).mean()), 4),
        "gt10": round(float((np.abs(error) > 10).mean()), 4),
        "gt15": round(float((np.abs(error) > 15).mean()), 4),
        "gt20": round(float((np.abs(error) > 20).mean()), 4),
    }


def score(stats, position):
    value = .04 * stats.get("passing_yards", 0) + 4 * stats.get("passing_touchdowns", 0)
    value -= 2 * stats.get("interceptions_thrown", 0)
    value += .1 * stats.get("rushing_yards", 0) + 6 * stats.get("rushing_touchdowns", 0)
    value += stats.get("receptions", 0) + .1 * stats.get("receiving_yards", 0) + 6 * stats.get("receiving_touchdowns", 0)
    return max(0.0, float(value))


def current_history():
    history = pd.read_csv(HISTORY, dtype={"player_id": "string"})
    history = history.loc[history.season.between(2023, 2025) & history.season_type.eq("REG")].copy()
    weights = history.season.map({2023: .25, 2024: .55, 2025: 1.0}).fillna(0)
    for column in ["rush_attempts", "rushing_yards", "rushing_touchdowns", "fantasy_points_ppr"]:
        history[column] = pd.to_numeric(history[column], errors="coerce").fillna(0)
        history[f"weighted_{column}"] = history[column] * weights
    grouped = history.groupby("player_id").agg(
        games=("week", "count"), weight=("season", lambda s: s.map({2023: .25, 2024: .55, 2025: 1.0}).sum()),
        rush_attempts=("weighted_rush_attempts", "sum"), rushing_yards=("weighted_rushing_yards", "sum"),
        rushing_touchdowns=("weighted_rushing_touchdowns", "sum"), fantasy_ppr=("weighted_fantasy_points_ppr", "sum"),
    )
    for column in ["rush_attempts", "rushing_yards", "rushing_touchdowns", "fantasy_ppr"]:
        grouped[column] = grouped[column] / grouped.weight.clip(lower=.01)
    return grouped


def main():
    oof = pd.read_csv(OOF, low_memory=False)
    base = oof.v3_3_2.to_numpy(float)
    hierarchy = (.6 * oof.v3_3_2 + .4 * oof.v4_d_rookie).to_numpy(float)
    candidate = apply_v4_historical_safety(oof, base, hierarchy)
    oof["v4_consensus_core"] = candidate
    names = ["v3_3_2", "v4_consensus_core"]
    overall = {name: metrics(oof.fantasy_points_ppr, oof[name]) for name in names}
    positions = {position: {name: metrics(group.fantasy_points_ppr, group[name]) for name in names} for position, group in oof.groupby("historical_position")}
    rush_prior = oof[["rush_attempts_season_avg", "rush_attempts_l5", "rush_attempts_l8"]].median(axis=1).fillna(0)
    elite = oof.prior_season_position_rank_pct.fillna(0).ge(.9) & oof.career_games_before.ge(17)
    dual = oof.historical_position.eq("QB") & rush_prior.ge(5)
    cohorts = {
        "elite": {name: metrics(oof.loc[elite, "fantasy_points_ppr"], oof.loc[elite, name]) for name in names},
        "dual_threat_qb": {name: metrics(oof.loc[dual, "fantasy_points_ppr"], oof.loc[dual, name]) for name in names},
    }
    folds = {str(year): {name: metrics(group.fantasy_points_ppr, group[name]) for name in names} for year, group in oof.groupby("season")}
    role_change = {name: role_change_report(oof, name) for name in names}
    calibration = {name: chronological_quantile_calibration(oof, name) for name in names}
    prior_v4_report = json.loads((ROOT / "data/processed/model_v4_tournament.json").read_text())

    current3 = pd.read_csv(CURRENT_V3, dtype={"gsis_id": "string"})
    current4 = pd.read_csv(CURRENT_V4, dtype={"player_id": "string"})
    sleeper = pd.read_csv(SLEEPER, dtype={"gsis_id": "string"}).drop_duplicates("gsis_id")
    history = current_history()
    rows = []
    for _, old in current3.iterrows():
        prior = history.loc[old.gsis_id] if old.gsis_id in history.index else None
        v4 = current4.loc[current4.player_id.eq(old.gsis_id)]
        s = sleeper.loc[sleeper.gsis_id.eq(old.gsis_id)]
        old_stats = json.loads(old.projected_stats)
        stats = old_stats.copy()
        hierarchy_ppr = float(v4.iloc[0].v4_frozen_ensemble) if len(v4) else float(old.model_projection_ppr)
        hierarchy_stats = stats.copy()
        if len(v4):
            row = v4.iloc[0]
            mapping = {
                "pass_attempts": "projected_pass_attempts", "completions": "projected_completions",
                "passing_yards": "projected_pass_yards", "passing_touchdowns": "projected_pass_tds",
                "interceptions_thrown": "projected_interceptions", "rush_attempts": "projected_rush_attempts",
                "rushing_yards": "projected_rush_yards", "rushing_touchdowns": "projected_rush_tds",
                "targets": "projected_targets", "receptions": "projected_receptions",
                "receiving_yards": "projected_receiving_yards", "receiving_touchdowns": "projected_receiving_tds",
            }
            hierarchy_stats.update({target: float(row[source]) for target, source in mapping.items()})
        established = bool(old.established_starter) and float(old.recent_snap_pct or 0) >= .7
        if established and hierarchy_ppr < float(old.model_projection_ppr) - 1.5:
            hierarchy_stats, hierarchy_ppr = old_stats.copy(), float(old.model_projection_ppr)
        stats = hierarchy_stats
        historical_guard = False
        if old.position == "QB" and prior is not None and prior.games >= 17:
            if prior.rush_attempts >= 5 and stats.get("rush_attempts", 0) < prior.rush_attempts * .65:
                stats["rush_attempts"] = .55 * stats.get("rush_attempts", 0) + .45 * prior.rush_attempts; historical_guard = True
            if prior.rushing_yards >= 30 and stats.get("rushing_yards", 0) < prior.rushing_yards * .65:
                stats["rushing_yards"] = .55 * stats.get("rushing_yards", 0) + .45 * prior.rushing_yards; historical_guard = True
            if prior.rushing_touchdowns >= .2 and stats.get("rushing_touchdowns", 0) < prior.rushing_touchdowns * .55:
                stats["rushing_touchdowns"] = .65 * stats.get("rushing_touchdowns", 0) + .35 * prior.rushing_touchdowns; historical_guard = True
        if len(s):
            evidence = s.iloc[0]
            fields = [
                ("pass_attempts", "sleeper_pass_attempts"), ("passing_yards", "sleeper_pass_yards"),
                ("passing_touchdowns", "sleeper_pass_touchdowns"), ("rush_attempts", "sleeper_rush_attempts"),
                ("rushing_yards", "sleeper_rush_yards"), ("rushing_touchdowns", "sleeper_rush_touchdowns"),
                ("targets", "sleeper_targets"), ("receptions", "sleeper_receptions"),
                ("receiving_yards", "sleeper_receiving_yards"), ("receiving_touchdowns", "sleeper_receiving_touchdowns"),
            ]
            for target, source in fields:
                if pd.notna(evidence[source]) and float(evidence[source]) > 0:
                    stats[target] = .82 * stats.get(target, 0) + .18 * float(evidence[source])
        component = score(stats, old.position)
        sources = []
        sleeper_ppr = None
        vegas_ppr = None
        if len(s):
            evidence = s.iloc[0]
            sleeper_ppr = float(evidence.sleeper_projection - evidence.scoring_adjustment)
            vegas_ppr = float(evidence.jimmy_vegas_ppr) if bool(evidence.has_player_props) and pd.notna(evidence.jimmy_vegas_ppr) else None
            if sleeper_ppr > 0: sources.append(sleeper_ppr)
            if vegas_ppr and vegas_ppr > 0: sources.append(vegas_ppr)
        consensus = float(np.median(sources)) if sources else component
        disagreement = abs(consensus - component)
        weight = adaptive_consensus_weight(confidence=str(old.confidence), role_secure=bool(old.is_starter), disagreement=disagreement, sources=len(sources))
        final = component * (1 - weight) + consensus * weight
        rows.append({
            "player_id": old.gsis_id, "player_name": old.player_name, "position": old.position, "team": old.team,
            "v3_3_2": float(old.model_projection_ppr), "v4_hierarchy": hierarchy_ppr,
            "v4_component": component, "v4_consensus": final, "consensus_weight": weight,
            "sleeper_ppr": sleeper_ppr, "vegas_ppr": vegas_ppr, "historical_guard": historical_guard,
            "pass_attempts": stats.get("pass_attempts", 0), "passing_yards": stats.get("passing_yards", 0),
            "passing_touchdowns": stats.get("passing_touchdowns", 0), "rush_attempts": stats.get("rush_attempts", 0),
            "rushing_yards": stats.get("rushing_yards", 0), "rushing_touchdowns": stats.get("rushing_touchdowns", 0),
            "targets": stats.get("targets", 0), "receiving_touchdowns": stats.get("receiving_touchdowns", 0),
        })
    current = pd.DataFrame(rows)
    current.to_csv(CURRENT_OUTPUT, index=False)
    report = {
        "status": "experimental_not_promoted", "version": "v4.0-candidate",
        "historical": {
            "overall": overall, "folds": folds, "positions": positions, "cohorts": cohorts,
            "role_change": role_change, "calibration": calibration,
            "hierarchical_component_metrics": prior_v4_report.get("opportunity", {}).get("v4_d_rookie", {}),
        },
        "current": {
            "rows": len(current), "sleeper_coverage": int(current.sleeper_ppr.notna().sum()),
            "vegas_projection_coverage": int(current.vegas_ppr.notna().sum()),
            "historical_guards": int(current.historical_guard.sum()),
            "lamar": current.loc[current.player_name.eq("Lamar Jackson")].replace({np.nan: None}).to_dict("records"),
            "largest_changes": current.assign(delta=current.v4_consensus-current.v3_3_2).reindex((current.v4_consensus-current.v3_3_2).abs().sort_values(ascending=False).index).head(20).replace({np.nan: None}).to_dict("records"),
        },
        "promotion": {"recommended": False, "active_model": "v3.3.2", "blockers": [
            "No leakage-safe historical Sleeper projection archive is available to validate adaptive consensus weights.",
            "Historical player-prop coverage is unavailable locally and current props cover only 11 players.",
            "Current Week 1 market coverage does not include Lamar Jackson, so his repair relies on historical and Sleeper evidence only.",
        ]},
        "remote_projection_writes": 0,
    }
    OUTPUT.write_text(json.dumps(report, indent=2, default=lambda value: None if pd.isna(value) else str(value)) + "\n")
    print(json.dumps(report["historical"]["overall"], indent=2))
    print(json.dumps(report["current"]["lamar"], indent=2))
    print("RETAIN v3.3.2 — v4 consensus coverage is not sufficient for production promotion.")


if __name__ == "__main__":
    main()
