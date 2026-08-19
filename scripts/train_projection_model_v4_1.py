#!/usr/bin/env python3
"""Chronological v4.1 availability/role-state model tournament (local only)."""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from projection_pipeline.evaluation_scoreboard import chronological_quantile_calibration, regression_metrics, role_change_report
from projection_pipeline.v3_2_config import ROLLING_FOLDS, V3_2_ARTIFACT_DIR, V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v4_hierarchy import add_relative_room_features
from train_projection_model_v4 import (
    BASE_FEATURES, ROLE_FEATURES, ROOM_FEATURES, ROOKIE_FEATURES,
    add_actual_shares, fit_models, opportunity_metrics, predict,
)

ROOT = Path(__file__).resolve().parents[1]
AVAILABILITY = ROOT / "data/processed/player_week_availability_v4_1.csv.gz"
OUTPUT = ROOT / "data/processed/model_v4_1_tournament.json"
OOF = ROOT / "data/processed/model_v4_1_oof.csv.gz"

AVAILABILITY_BASE = [
    "is_active_expected", "is_out_known", "is_questionable", "is_doubtful",
    "availability_observed", "availability_confidence", "structurally_unavailable",
    "team_changed_v41", "weeks_since_team_change_v41", "weeks_since_last_opportunity",
]
VACANCY = [
    "room_active_count", "room_unavailable_count", "vacated_room_rush_share",
    "vacated_room_target_share", "top_competitor_out", "starter_ahead_unavailable",
]
STARTER = [
    "returning_from_injury_or_reserve", "depth_rank_improved", "depth_rank_declined",
    "new_starter_probability", "prior_rush_share_l3", "prior_target_share_l3",
]
VARIANTS = {
    "v4_1_a_availability": AVAILABILITY_BASE,
    "v4_1_b_vacancy": AVAILABILITY_BASE + VACANCY,
    "v4_1_c_starter": AVAILABILITY_BASE + VACANCY + STARTER,
}


def main() -> None:
    started = time.perf_counter()
    base = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    availability = pd.read_csv(AVAILABILITY, dtype={"player_id": "string", "team": "string"}).rename(columns={
        "team_changed": "team_changed_v41", "weeks_since_team_change": "weeks_since_team_change_v41",
    })
    keys = ["player_id", "season", "week"]
    extra = list(dict.fromkeys(AVAILABILITY_BASE + VACANCY + STARTER))
    frame = base.merge(availability[keys + extra], on=keys, how="left", validate="one_to_one")
    role = pd.read_csv(ROOT / "data/processed/player_week_role_state_v4.csv.gz", dtype={"player_id": "string"})
    role_extra = [c for c in role.columns if c not in frame.columns or c in keys]
    frame = frame.merge(role[role_extra], on=keys, how="left", validate="one_to_one")
    frame["team"] = frame.canonical_team.fillna(frame.team)
    for column in set(ROLE_FEATURES + ROOKIE_FEATURES + extra):
        frame[column] = pd.to_numeric(frame.get(column, 0), errors="coerce").fillna(0)
    frame = add_relative_room_features(add_actual_shares(frame))
    baseline = pd.read_csv(V3_2_ARTIFACT_DIR.parent / "v3_3_2/rolling_validation_predictions.csv.gz", dtype={"player_id": "string"})
    baseline = baseline.rename(columns={"e6_tail_safety_rising_role": "v3_3_2"})
    eligible = baseline[keys + ["historical_position", "v3_3_2"]]
    folds = []
    base_features = BASE_FEATURES + ROLE_FEATURES + ROOM_FEATURES + ROOKIE_FEATURES
    for train_end, year in ROLLING_FOLDS:
        print(f"v4.1 fold {year}", flush=True)
        train = frame.loc[frame.season.between(2018, train_end)].reset_index(drop=True)
        validation = frame.loc[frame.season.eq(year)].reset_index(drop=True)
        fold = validation.merge(eligible.loc[eligible.season.eq(year)], on=keys + ["historical_position"], how="inner", validate="one_to_one")
        validation = validation.merge(fold[keys], on=keys, how="inner", validate="one_to_one")
        for name, additions in VARIANTS.items():
            features = base_features + additions
            _, components, ppr, direct = predict(validation, features, fit_models(train, features), 0, target_pass_ratio=.985)
            fold[name] = ppr
            fold[f"_{name}_direct"] = direct
            for column in components:
                fold[f"_{name}_{column}"] = components[column].to_numpy()
            fold[f"ensemble_{name}"] = .6 * fold.v3_3_2 + .4 * fold[name]
        folds.append(fold)
    oof = pd.concat(folds, ignore_index=True)
    names = ["v3_3_2", *VARIANTS, *(f"ensemble_{name}" for name in VARIANTS)]
    report = {
        "status": "experimental_local_only", "feature_version": "hierarchical_v4_1_availability_24h_v1",
        "cutoff_hours": 24, "folds": {str(y): {n: regression_metrics(g.fantasy_points_ppr, g[n]) for n in names} for y, g in oof.groupby("season")},
        "overall": {n: regression_metrics(oof.fantasy_points_ppr, oof[n]) for n in names},
        "positions": {p: {n: regression_metrics(g.fantasy_points_ppr, g[n]) for n in names} for p, g in oof.groupby("historical_position")},
        "role_change": {n: role_change_report(oof, n) for n in names},
        "calibration": {n: chronological_quantile_calibration(oof, n) for n in names},
        "opportunity": {n: opportunity_metrics(oof, oof[[f"_{n}_{c}" for c in ["pass_attempts", "rush_attempts", "targets"]]].rename(columns=lambda c: c.removeprefix(f"_{n}_"))) for n in VARIANTS},
        "coherence": {n: {"target_over_pass_teams": int((oof.assign(_p=oof[f"_{n}_pass_attempts"], _t=oof[f"_{n}_targets"]).groupby(["season", "week", "team"])[["_p", "_t"]].sum().eval("_t > _p + 1e-9")).sum())} for n in VARIANTS},
        "runtime_seconds": round(time.perf_counter() - started, 3), "production_unchanged": True,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    oof.to_csv(OOF, index=False, compression="gzip")
    print(json.dumps(report["overall"], indent=2))
    print(json.dumps(report["coherence"], indent=2))


if __name__ == "__main__":
    main()
