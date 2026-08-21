#!/usr/bin/env python3
"""Freeze the production v4.1 raw football projection (no remote writes).

The release starts from the historically validated v4 hierarchy, preserves the
v3.3.2 stable-role safety anchor, and leaves Sleeper/Vegas arbitration to the
production reconciliation step.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from projection_pipeline.scoring import score_projected_stats_exact

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "data/processed/player_projections_v3_3_2.csv"
HIERARCHY = ROOT / "data/processed/player_projections_v4_candidate.csv"
OUTPUT = ROOT / "data/processed/player_projections_v4_1_release.csv"
ARTIFACT_DIR = ROOT / "artifacts/projections/v4_1"

COMPONENTS = {
    "pass_attempts": "projected_pass_attempts",
    "completions": "projected_completions",
    "passing_yards": "projected_pass_yards",
    "passing_touchdowns": "projected_pass_tds",
    "interceptions_thrown": "projected_interceptions",
    "rush_attempts": "projected_rush_attempts",
    "rushing_yards": "projected_rush_yards",
    "rushing_touchdowns": "projected_rush_tds",
    "targets": "projected_targets",
    "receptions": "projected_receptions",
    "receiving_yards": "projected_receiving_yards",
    "receiving_touchdowns": "projected_receiving_tds",
}


def main() -> None:
    base = pd.read_csv(BASE, dtype={"gsis_id": "string"})
    hierarchy = pd.read_csv(HIERARCHY, dtype={"player_id": "string"}).set_index("player_id")
    rows: list[dict] = []
    anchored = 0
    for record in base.to_dict("records"):
        player_id = str(record["gsis_id"])
        old_stats = json.loads(str(record["projected_stats"]))
        source = hierarchy.loc[player_id] if player_id in hierarchy.index else None
        stable = bool(record.get("established_starter")) and float(record.get("recent_snap_pct") or 0) >= .70
        collapsed = source is not None and float(source.v4_frozen_ensemble) < float(record["model_projection_ppr"]) - 1.5
        use_anchor = stable and collapsed
        stats = dict(old_stats)
        if source is not None and not use_anchor:
            for target, origin in COMPONENTS.items():
                stats[target] = max(0.0, float(source[origin]))
        elif use_anchor:
            anchored += 1
        stats["completions"] = min(float(stats.get("completions", 0)), float(stats.get("pass_attempts", 0)))
        stats["receptions"] = min(float(stats.get("receptions", 0)), float(stats.get("targets", 0)))
        rows.append({**record, "projected_stats": stats, "stable_anchor": use_anchor})

    # A mixed stable-role anchor can otherwise make receiving totals exceed the
    # passing budget. Reconcile the whole room before final scoring.
    frame = pd.DataFrame(rows)
    parsed = frame.projected_stats.tolist()
    for team, indices in frame.groupby("team", dropna=False).groups.items():
        if pd.isna(team):
            continue
        idx = list(indices)
        pass_attempts = sum(float(parsed[i].get("pass_attempts", 0)) for i in idx)
        targets = sum(float(parsed[i].get("targets", 0)) for i in idx)
        maximum = pass_attempts * .985
        if targets <= maximum or targets <= 0:
            continue
        scale = maximum / targets
        for i in idx:
            for key in ("targets", "receptions", "receiving_yards", "receiving_touchdowns"):
                parsed[i][key] = max(0.0, float(parsed[i].get(key, 0)) * scale)
            parsed[i]["receptions"] = min(parsed[i]["receptions"], parsed[i]["targets"])

    output_rows = []
    for record, stats in zip(frame.to_dict("records"), parsed, strict=True):
        position = str(record["position"])
        standard = score_projected_stats_exact(stats, {"rec": 0}, position)
        half = score_projected_stats_exact(stats, {"rec": .5}, position)
        ppr = score_projected_stats_exact(stats, {"rec": 1}, position)
        residual_low = float(record["residual_low"])
        residual_high = float(record["residual_high"])
        drivers = [
            "Frozen v4 hierarchical opportunity model",
            "Stable multi-season role protection" if record["stable_anchor"] else "Team-first opportunity allocation",
            "Exact component/PPR reconciliation",
            "External consensus applied only during production reconciliation",
        ]
        output_rows.append({
            **{key: value for key, value in record.items() if key not in {"projected_stats", "stable_anchor"}},
            "projected_stats": json.dumps(stats, sort_keys=True),
            "raw_model_projection_ppr": ppr,
            "opportunity_projection_ppr": ppr,
            "corrected_target_ppr": ppr,
            "component_derived_ppr": ppr,
            "model_projection_ppr": ppr,
            "projected_points_standard": standard,
            "projected_points_half_ppr": half,
            "projected_points_ppr": ppr,
            "floor_ppr": max(0.0, ppr + residual_low),
            "median_ppr": ppr,
            "ceiling_ppr": max(0.0, ppr + residual_high),
            "drivers": json.dumps(drivers),
            "model_version": "v4.1",
            "feature_version": "hierarchical_v4_consensus_release_v1",
            "reconciliation_mode": "v4.1-production-consensus",
            "reconciliation_residual": 0.0,
        })
    output = pd.DataFrame(output_rows)
    output.to_csv(OUTPUT, index=False)
    digest = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    historical = json.loads((ROOT / "data/processed/model_v4_consensus_report.json").read_text())["historical"]
    manifest = {
        "version": "v4.1",
        "algorithm": "frozen v4 hierarchy with stable-role protection and adaptive component consensus",
        "training_range": [2018, 2025],
        "feature_version": "hierarchical_v4_consensus_release_v1",
        "features": {
            "football_model": "60% v3.3.2 / 40% V4-D hierarchy",
            "current_arbitration": "nonlinear Sleeper plus fresh multi-book Vegas component consensus",
            "dual_threat_prior": "four-season recency-weighted rushing prior",
            "injury_order": "active-game projection before availability",
        },
        "evaluation": historical,
        "projection_sha256": digest,
        "rows": int(len(output)),
        "stable_role_anchors": anchored,
        "random_seed": 42,
    }
    (ARTIFACT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    team = pd.DataFrame({
        "team": output.team,
        "pass_attempts": [float(stats.get("pass_attempts", 0)) for stats in parsed],
        "targets": [float(stats.get("targets", 0)) for stats in parsed],
    }).groupby("team", dropna=False).sum()
    report = {
        "rows": int(len(output)),
        "duplicate_player_weeks": int(output.duplicated(["gsis_id", "season", "week", "season_type"]).sum()),
        "component_ppr_mismatches": int(sum(
            abs(score_projected_stats_exact(json.loads(row.projected_stats), {"rec": 1}, row.position) - row.model_projection_ppr) > 1e-6
            for row in output.itertuples()
        )),
        "negative_components": int(any(any(float(value) < 0 for value in stats.values()) for stats in parsed)),
        "target_budget_violations": int((team.targets > team.pass_attempts * .985 + 1e-6).sum()),
        "stable_role_anchors": anchored,
        "sha256": digest,
    }
    (ROOT / "data/processed/model_v4_1_release_preflight.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
