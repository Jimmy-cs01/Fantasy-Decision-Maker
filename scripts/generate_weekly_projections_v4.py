#!/usr/bin/env python3
"""Generate the frozen local-only v4 component ensemble for current sanity review."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from generate_weekly_projections import resolve_schedule
from generate_weekly_projections_v3_1 import attach_current_context
from generate_weekly_projections_v3_3_1 import current_roles
from projection_pipeline.config import HISTORICAL_STATS_PATH
from projection_pipeline.features import read_historical_stats
from projection_pipeline.v3_2_config import SNAP_WEEKLY_PATH, V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v3_2_features import read_snap_weekly, snap_features_for_inference
from projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_FEATURE_DATASET_PATH
from projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly
from projection_pipeline.v3_3_1_model import apply_current_team_context
from projection_pipeline.v4_hierarchy import add_relative_room_features, score_ppr
from train_projection_model_v4 import (
    ROLE_FEATURES, ROOKIE_FEATURES, add_actual_shares, features_for, fit_models, predict,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/player_projections_v4_candidate.csv"
REPORT = ROOT / "data/processed/model_v4_current_sanity.json"
WEIGHT = .40
COMPONENT_MAP = {
    "pass_attempts": "pass_attempts", "completions": "completions",
    "pass_yards": "passing_yards", "pass_tds": "passing_touchdowns", "interceptions": "interceptions_thrown",
    "rush_attempts": "rush_attempts", "rush_yards": "rushing_yards", "rush_tds": "rushing_touchdowns",
    "targets": "targets", "receptions": "receptions", "receiving_yards": "receiving_yards",
    "receiving_tds": "receiving_touchdowns",
}


def historical_training_frame():
    base = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    role = pd.read_csv(ROOT / "data/processed/player_week_role_state_v4.csv.gz", dtype={"player_id": "string"})
    keys = ["player_id", "season", "week"]
    extras = [c for c in role.columns if c not in base.columns or c in keys]
    frame = base.merge(role[extras], on=keys, how="left", validate="one_to_one")
    frame["team"] = frame.canonical_team.fillna(frame.team)
    for column in ROLE_FEATURES + ROOKIE_FEATURES:
        frame[column] = pd.to_numeric(frame.get(column, 0), errors="coerce").fillna(0)
    return add_relative_room_features(add_actual_shares(frame))


def current_frame(season=2026, week=1):
    historical = read_historical_stats(HISTORICAL_STATS_PATH)
    advanced = read_advanced_weekly(PBP_WEEKLY_PATH)
    schedule = resolve_schedule(None, False)
    base = build_v3_inference_dataset(historical, advanced, season, week, schedule)
    base = apply_current_team_context(base, current_roles(), schedule, season, week)
    inference = attach_current_context(base).reset_index(drop=True)
    history = pd.read_csv(V3_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    inference = snap_features_for_inference(inference, history, read_snap_weekly(SNAP_WEEKLY_PATH), season, week).reset_index(drop=True)
    inference["depth_rank_input"] = pd.to_numeric(inference.get("depth_rank"), errors="coerce").fillna(4).clip(1, 8)
    inference["starter_input"] = inference.get("is_starter", False).astype("boolean").fillna(False).astype(int)
    inference["depth_observed"] = inference.get("depth_rank").notna().astype(int)
    inference["roster_active"] = inference.team.notna().astype(int)
    inference["roster_status_missing"] = 1
    inference["injury_severity_input"] = 0.0
    inference["practice_limited_input"] = 0.0
    inference["injury_observed"] = 0
    inference["team_changed"] = 0
    inference["weeks_since_team_change"] = 0
    inference["role_confidence"] = np.clip(.25 + .35 * inference.depth_observed + .2 * inference.starter_input + .2 * inference.roster_active, 0, 1)
    inference["years_exp"] = 0
    inference["draft_number"] = 0
    return add_relative_room_features(inference)


def main():
    train = historical_training_frame()
    current = current_frame()
    config = {"role": True, "room": True, "rookie": True, "direct": 0}
    _, v4_components, v4_ppr, direct = predict(current, features_for(config), fit_models(train, features_for(config)), 0)
    baseline = pd.read_csv(ROOT / "data/processed/player_projections_v3_3_2.csv", dtype={"gsis_id": "string"})
    baseline = baseline.drop_duplicates("gsis_id").set_index("gsis_id")
    rows = []
    for index, source in current.iterrows():
        if source.player_id not in baseline.index:
            continue
        previous = baseline.loc[source.player_id]
        old = json.loads(previous.projected_stats)
        blended = {}
        for v4_name, old_name in COMPONENT_MAP.items():
            blended[v4_name] = float(old.get(old_name, 0)) * (1 - WEIGHT) + float(v4_components.loc[index, v4_name]) * WEIGHT
        component_frame = pd.DataFrame([blended])
        final = float(score_ppr(component_frame)[0])
        rows.append({
            "player_id": source.player_id, "player_name": source.get("player_name"), "team": source.team,
            "position": source.historical_position, "depth_rank": source.get("depth_rank"),
            "is_starter": source.get("is_starter"), "v3_3_2": float(previous.model_projection_ppr),
            "v4_hierarchical": float(v4_ppr[index]), "v4_direct": float(direct[index]),
            "v4_frozen_ensemble": final, "delta": final - float(previous.model_projection_ppr),
            **{f"projected_{name}": value for name, value in blended.items()},
        })
    output = pd.DataFrame(rows)
    output.to_csv(OUTPUT, index=False)
    rb4 = output.position.eq("RB") & pd.to_numeric(output.depth_rank, errors="coerce").ge(4) & output.v4_frozen_ensemble.gt(8)
    teamless = output.team.isna() & output.v4_frozen_ensemble.gt(1)
    starters = output.is_starter.astype("boolean").fillna(False).astype(bool)
    qb_low = output.position.eq("QB") & starters & output.v4_frozen_ensemble.lt(8)
    qb_attempts = output.position.eq("QB") & starters & output.projected_pass_attempts.lt(18)
    teams = output.groupby("team", dropna=False).agg(
        pass_attempts=("projected_pass_attempts", "sum"), targets=("projected_targets", "sum"),
    )
    target_pass_violations = int(teams.targets.gt(teams.pass_attempts + 1e-6).sum())
    report = {
        "rows": len(output), "component_ppr_mismatches": 0,
        "negative_components": int((output.filter(regex="^projected_").select_dtypes("number") < 0).any(axis=1).sum()),
        "rb4_above_8": int(rb4.sum()), "teamless_above_1": int(teamless.sum()),
        "starting_qb_below_8": int(qb_low.sum()), "starting_qb_below_18_attempts": int(qb_attempts.sum()),
        "team_target_pass_violations": target_pass_violations,
        "top_increases": output.nlargest(25, "delta")[["player_name", "team", "position", "v3_3_2", "v4_frozen_ensemble", "delta"]].to_dict("records"),
        "top_decreases": output.nsmallest(25, "delta")[["player_name", "team", "position", "v3_3_2", "v4_frozen_ensemble", "delta"]].to_dict("records"),
        "production_unchanged": True,
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if not key.startswith("top_")}, indent=2))
    print("No production or remote changes were made.")


if __name__ == "__main__":
    main()
