#!/usr/bin/env python3
"""Local-only chronological tournament for the end-to-end v4 hierarchy."""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from projection_pipeline.config import DIRECT_TARGET
from projection_pipeline.evaluation_scoreboard import (
    chronological_quantile_calibration, regression_metrics, role_change_report,
)
from projection_pipeline.v3_2_config import RANDOM_SEED, ROLLING_FOLDS, V3_2_ARTIFACT_DIR, V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v4_hierarchy import (
    add_relative_room_features, allocate_positive_shares, blend_components_to_direct,
    coherent_components, score_ppr,
)
from experiment_team_volume_v3_4 import FEATURES as TEAM_FEATURES, team_frame

ROOT = Path(__file__).resolve().parents[1]
ROLE_PATH = ROOT / "data/processed/player_week_role_state_v4.csv.gz"
OUTPUT = ROOT / "data/processed/model_v4_tournament.json"
OOF = ROOT / "data/processed/model_v4_oof.csv.gz"

ROLE_FEATURES = [
    "depth_rank_input", "starter_input", "depth_observed", "roster_active",
    "roster_status_missing", "injury_severity_input", "practice_limited_input",
    "injury_observed", "team_changed", "weeks_since_team_change", "role_confidence",
]
ROOM_FEATURES = ["room_snap_delta", "room_target_share_delta", "room_rush_share_delta", "room_depth_advantage"]
ROOKIE_FEATURES = ["years_exp", "draft_number"]
BASE_FEATURES = [
    "career_games_before", "prior_season_games", "prior_season_rush_attempts_pg",
    "prior_season_targets_pg", "snap_pct_last_1", "snap_pct_last_3", "snap_history_available",
    "team_rush_share_l3", "team_rush_share_l5", "team_rush_share_l8",
    "backfield_rush_share_l3", "backfield_rush_share_l5", "pbp_target_share_l3",
    "pbp_target_share_l5", "pbp_target_share_l8", "backfield_target_share_l3",
    "backfield_target_share_l5", "pbp_pass_attempts_l3", "pbp_pass_attempts_l5",
    "pbp_rush_attempts_l3", "pbp_targets_l3", "pbp_targets_l5",
    "fantasy_points_ppr_l3", "fantasy_points_ppr_l5", "is_home", "days_rest",
]
RATE_TARGETS = {
    "completion_rate": ("completions", "pass_attempts", .64),
    "pass_yards_per_attempt": ("passing_yards", "pass_attempts", 7.0),
    "pass_td_rate": ("passing_touchdowns", "pass_attempts", .045),
    "interception_rate": ("interceptions_thrown", "pass_attempts", .023),
    "rush_yards_per_attempt": ("rushing_yards", "rush_attempts", 4.2),
    "rush_td_rate": ("rushing_touchdowns", "rush_attempts", .03),
    "catch_rate": ("receptions", "targets", .67),
    "receiving_yards_per_target": ("receiving_yards", "targets", 7.2),
    "receiving_td_rate": ("receiving_touchdowns", "targets", .04),
}
VARIANTS = {
    "v4_a_hierarchy": {"role": False, "room": False, "rookie": False, "direct": 0},
    "v4_b_role": {"role": True, "room": False, "rookie": False, "direct": 0},
    "v4_c_room": {"role": True, "room": True, "rookie": False, "direct": 0},
    "v4_d_rookie": {"role": True, "room": True, "rookie": True, "direct": 0},
    "v4_e_direct_10": {"role": True, "room": True, "rookie": True, "direct": .10},
    "v4_e_direct_20": {"role": True, "room": True, "rookie": True, "direct": .20},
}


def model() -> XGBRegressor:
    return XGBRegressor(
        objective="reg:squarederror", n_estimators=180, max_depth=3, learning_rate=.035,
        min_child_weight=12, subsample=.85, colsample_bytree=.8, reg_lambda=7,
        n_jobs=4, random_state=RANDOM_SEED,
    )


def features_for(config: dict) -> list[str]:
    features = BASE_FEATURES.copy()
    if config["role"]:
        features += ROLE_FEATURES
    if config["room"]:
        features += ROOM_FEATURES
    if config["rookie"]:
        features += ROOKIE_FEATURES
    return features


def add_actual_shares(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    groups = output.groupby(["season", "week", "team"], dropna=False)
    output["actual_team_pass"] = groups.pass_attempts.transform("sum")
    output["actual_team_rush"] = groups.rush_attempts.transform("sum")
    output["actual_team_targets"] = groups.targets.transform("sum")
    output["qb_pass_share"] = output.pass_attempts / output.actual_team_pass.replace(0, np.nan)
    output["player_rush_share"] = output.rush_attempts / output.actual_team_rush.replace(0, np.nan)
    output["player_target_share"] = output.targets / output.actual_team_targets.replace(0, np.nan)
    return output


def fit_models(train: pd.DataFrame, features: list[str]):
    teams = team_frame(train)
    team_models = {
        short: model().fit(teams[TEAM_FEATURES], teams[target])
        for target, short in (("actual_pass_attempts", "pass"), ("actual_rush_attempts", "rush"), ("actual_targets", "target"))
    }
    share_models = {}
    for position in ("QB", "RB", "WR", "TE"):
        rows = train.loc[train.historical_position.eq(position)]
        targets = ["player_target_share"] if position != "QB" else ["qb_pass_share", "player_rush_share"]
        if position == "RB":
            targets.append("player_rush_share")
        for target in targets:
            usable = rows.loc[rows[target].notna()]
            share_models[(position, target)] = model().fit(usable[features], usable[target])
    rate_models = {}
    for position in ("QB", "RB", "WR", "TE"):
        rows = train.loc[train.historical_position.eq(position)]
        for name, (numerator, denominator, prior) in RATE_TARGETS.items():
            if position != "QB" and name.startswith(("completion", "pass_", "interception")):
                rate_models[(position, name)] = prior
                continue
            if position == "QB" and name in ("catch_rate", "receiving_yards_per_target", "receiving_td_rate"):
                rate_models[(position, name)] = prior
                continue
            den = pd.to_numeric(rows[denominator], errors="coerce").fillna(0)
            rate = (pd.to_numeric(rows[numerator], errors="coerce").fillna(0) + prior * 8) / (den + 8)
            rate_models[(position, name)] = model().fit(rows[features], rate)
    direct_models = {
        position: model().fit(rows[features], rows[DIRECT_TARGET])
        for position, rows in train.groupby("historical_position")
    }
    return team_models, share_models, rate_models, direct_models


def predict(frame: pd.DataFrame, features: list[str], models, direct_weight: float, target_pass_ratio: float = 1.0):
    team_models, share_models, rate_models, direct_models = models
    output = frame.reset_index(drop=True).copy()
    teams = output.groupby(["season", "week", "team"], as_index=False).first()
    for short, fitted in team_models.items():
        teams[f"budget_{short}"] = np.maximum(0, fitted.predict(teams[TEAM_FEATURES]))
    output = output.merge(teams[["season", "week", "team", "budget_pass", "budget_rush", "budget_target"]],
                          on=["season", "week", "team"], how="left", validate="many_to_one")
    # A target must originate from a pass attempt. The cap is generic and keeps
    # the hierarchy coherent while still allowing an explicit OTHER bucket.
    raw_pass = np.zeros(len(output)); raw_rush = np.zeros(len(output)); raw_target = np.zeros(len(output))
    direct = np.zeros(len(output)); rates = {name: np.full(len(output), prior) for name, (_, _, prior) in RATE_TARGETS.items()}
    for position, indices in output.groupby("historical_position").groups.items():
        idx = np.asarray(list(indices), dtype=int)
        direct[idx] = direct_models[position].predict(output.loc[idx, features])
        if (position, "qb_pass_share") in share_models:
            raw_pass[idx] = share_models[(position, "qb_pass_share")].predict(output.loc[idx, features])
        if (position, "player_rush_share") in share_models:
            raw_rush[idx] = share_models[(position, "player_rush_share")].predict(output.loc[idx, features])
        if (position, "player_target_share") in share_models:
            raw_target[idx] = share_models[(position, "player_target_share")].predict(output.loc[idx, features])
        for name in rates:
            fitted = rate_models[(position, name)]
            if not isinstance(fitted, float):
                rates[name][idx] = fitted.predict(output.loc[idx, features])
    pass_attempts = allocate_positive_shares(output, raw_pass, output.budget_pass, output.historical_position.eq("QB"), 1.0)
    rush_attempts = allocate_positive_shares(output, raw_rush, output.budget_rush, output.historical_position.isin(["QB", "RB"]), .96)
    # Reconcile receiving volume to attempts actually assigned to quarterbacks,
    # not merely to the upstream team budget. This covers partial QB-share
    # allocation and guarantees player targets cannot outrun pass attempts.
    allocated_pass = pd.Series(pass_attempts, index=output.index).groupby(
        [output.season, output.week, output.team], dropna=False
    ).transform("sum")
    target_budget = np.minimum(output.budget_target, allocated_pass * target_pass_ratio)
    targets = allocate_positive_shares(output, raw_target, target_budget, output.historical_position.isin(["RB", "WR", "TE"]), .96)
    components = coherent_components(output, pass_attempts, rush_attempts, targets, rates)
    components = blend_components_to_direct(components, direct, direct_weight)
    return output, components, score_ppr(components), direct


def opportunity_metrics(frame: pd.DataFrame, components: pd.DataFrame) -> dict:
    def mae(actual, predicted): return round(float(np.mean(np.abs(np.asarray(actual) - np.asarray(predicted)))), 4)
    report = {
        "qb_pass_attempts_mae": mae(frame.loc[frame.historical_position.eq("QB"), "pass_attempts"], components.loc[frame.historical_position.eq("QB"), "pass_attempts"]),
        "qb_rush_attempts_mae": mae(frame.loc[frame.historical_position.eq("QB"), "rush_attempts"], components.loc[frame.historical_position.eq("QB"), "rush_attempts"]),
        "rb_carries_mae": mae(frame.loc[frame.historical_position.eq("RB"), "rush_attempts"], components.loc[frame.historical_position.eq("RB"), "rush_attempts"]),
    }
    for position in ("RB", "WR", "TE"):
        mask = frame.historical_position.eq(position)
        report[f"{position.lower()}_targets_mae"] = mae(frame.loc[mask, "targets"], components.loc[mask, "targets"])
    grouped = frame.groupby(["season", "week", "team"], dropna=False)
    predicted = components.assign(season=frame.season, week=frame.week, team=frame.team).groupby(["season", "week", "team"]).sum(numeric_only=True)
    actual = grouped[["pass_attempts", "rush_attempts", "targets"]].sum()
    for field in ("pass_attempts", "rush_attempts", "targets"):
        report[f"team_{field}_mae"] = mae(actual[field], predicted[field])
    return report


def main() -> None:
    started = time.perf_counter()
    base = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    role = pd.read_csv(ROLE_PATH, dtype={"player_id": "string", "team": "string"})
    keys = ["player_id", "season", "week"]
    extras = [c for c in role.columns if c not in base.columns or c in keys]
    frame = base.merge(role[extras], on=keys, how="left", validate="one_to_one")
    frame["team"] = frame.canonical_team.fillna(frame.team)
    for column in ROLE_FEATURES + ROOKIE_FEATURES:
        frame[column] = pd.to_numeric(frame.get(column, 0), errors="coerce").fillna(0)
    frame = add_relative_room_features(add_actual_shares(frame))
    baseline = pd.read_csv(V3_2_ARTIFACT_DIR.parent / "v3_3_2/rolling_validation_predictions.csv.gz", dtype={"player_id": "string"})
    baseline = baseline.rename(columns={"e6_tail_safety_rising_role": "v3_3_2"})
    eligible_keys = baseline[keys + ["historical_position", "v3_3_2"]]
    folds = []
    for train_end, year in ROLLING_FOLDS:
        print(f"v4 fold {year}", flush=True)
        train = frame.loc[frame.season.between(2018, train_end)].reset_index(drop=True)
        validation = frame.loc[frame.season.eq(year)].reset_index(drop=True)
        fold = validation.merge(eligible_keys.loc[eligible_keys.season.eq(year)], on=keys + ["historical_position"], how="inner", validate="one_to_one")
        validation = validation.merge(fold[keys], on=keys, how="inner", validate="one_to_one")
        for name, config in VARIANTS.items():
            features = features_for(config)
            predicted_frame, components, ppr, direct = predict(validation, features, fit_models(train, features), config["direct"])
            fold[name] = ppr
            fold[f"_{name}_direct"] = direct
            for column in components:
                fold[f"_{name}_{column}"] = components[column].to_numpy()
        folds.append(fold)
    oof = pd.concat(folds, ignore_index=True)
    names = ["v3_3_2", *VARIANTS]
    report = {
        "status": "experimental_local_only",
        "feature_version": "hierarchical_v4_pregame_role_v1",
        "folds": {str(year): {name: regression_metrics(group[DIRECT_TARGET], group[name]) for name in names} for year, group in oof.groupby("season")},
        "overall": {name: regression_metrics(oof[DIRECT_TARGET], oof[name]) for name in names},
        "positions": {position: {name: regression_metrics(group[DIRECT_TARGET], group[name]) for name in names} for position, group in oof.groupby("historical_position")},
        "role_change": {name: role_change_report(oof, name) for name in names},
        "calibration": {name: chronological_quantile_calibration(oof, name) for name in names},
        "opportunity": {
            name: opportunity_metrics(oof, oof[[f"_{name}_{c}" for c in ["pass_attempts", "rush_attempts", "targets"]]].rename(columns=lambda c: c.removeprefix(f"_{name}_")))
            for name in VARIANTS
        },
        "runtime_seconds": round(time.perf_counter() - started, 3),
        "production_unchanged": True,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    oof.to_csv(OOF, index=False, compression="gzip")
    print(json.dumps(report["overall"], indent=2))
    print("No production or remote changes were made.")


if __name__ == "__main__":
    main()
