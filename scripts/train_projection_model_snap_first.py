#!/usr/bin/env python3
"""Leakage-safe SNAP-first hierarchy tournament; never writes production data."""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from projection_pipeline.evaluation_scoreboard import regression_metrics, role_change_report
from projection_pipeline.v3_2_config import RANDOM_SEED, ROLLING_FOLDS, V3_2_ARTIFACT_DIR, V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v4_hierarchy import add_relative_room_features
from train_projection_model_v4 import (
    BASE_FEATURES, ROLE_FEATURES, ROOM_FEATURES, ROOKIE_FEATURES,
    add_actual_shares, fit_models, opportunity_metrics, predict,
)
from train_projection_model_v4_1 import AVAILABILITY, AVAILABILITY_BASE, STARTER, VACANCY
from xgboost import XGBRegressor

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/model_snap_first_tournament.json"
OOF = ROOT / "data/processed/model_snap_first_oof.csv.gz"
PROJECTED_SNAP = ROOT / "data/processed/player_week_projected_snap_share.csv.gz"

SNAP_FAMILIES = {
    "no_snap": [],
    "previous": ["snap_pct_last_1", "snap_history_available"],
    "rolling": ["snap_pct_last_1", "snap_pct_last_3", "snap_pct_last_5", "snap_games_last_3", "snap_games_last_5", "snap_history_available"],
    "rolling_trend": ["snap_pct_last_1", "snap_pct_last_3", "snap_pct_last_5", "snap_games_last_3", "snap_games_last_5", "snap_pct_delta_1", "snap_pct_trend_3", "snap_history_available"],
    "full": [
        "snap_pct_last_1", "snap_pct_last_3", "snap_pct_last_5", "snap_games_last_3", "snap_games_last_5",
        "snap_pct_delta_1", "snap_pct_trend_3", "position_group_snap_share_last_1",
        "position_group_snap_share_last_3", "rush_attempts_per_snap_last_3",
        "targets_per_snap_last_3", "touches_per_snap_last_3", "snap_prior_same_team",
        "snap_prior_same_season", "snap_history_available", "snap_share_last_8",
        "snap_share_season_prior", "snap_share_variance_5", "room_snap_rank", "room_snap_gap_to_leader",
    ],
}


def model() -> XGBRegressor:
    return XGBRegressor(
        objective="reg:squarederror", n_estimators=180, max_depth=3, learning_rate=.035,
        min_child_weight=12, subsample=.85, colsample_bytree=.8, reg_lambda=7,
        n_jobs=4, random_state=RANDOM_SEED,
    )


def add_snap_history(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.sort_values(["player_id", "season", "week"]).copy()
    grouped = output.groupby("player_id", sort=False)["offensive_snap_pct"]
    shifted = grouped.shift(1)
    output["snap_share_last_8"] = shifted.groupby(output.player_id, sort=False).transform(
        lambda s: s.rolling(8, min_periods=1).mean()
    )
    output["snap_share_variance_5"] = shifted.groupby(output.player_id, sort=False).transform(
        lambda s: s.rolling(5, min_periods=2).std()
    )
    output["snap_share_season_prior"] = shifted.groupby([output.player_id, output.season], sort=False).transform(
        lambda s: s.expanding().mean()
    )
    room = [output.season, output.week, output.team, output.historical_position]
    prior = pd.to_numeric(output.snap_pct_last_1, errors="coerce")
    output["room_snap_rank"] = prior.groupby(room, dropna=False).rank(method="min", ascending=False)
    leader = prior.groupby(room, dropna=False).transform("max")
    output["room_snap_gap_to_leader"] = leader - prior
    starter = pd.to_numeric(output["starter_input"], errors="coerce").fillna(0) if "starter_input" in output else pd.Series(0, index=output.index)
    changed = pd.to_numeric(output["team_changed_v41"], errors="coerce").fillna(0) if "team_changed_v41" in output else pd.Series(0, index=output.index)
    unavailable = pd.to_numeric(output["structurally_unavailable"], errors="coerce").fillna(0) if "structurally_unavailable" in output else pd.Series(0, index=output.index)
    output["stable_role_prior"] = (
        starter.ge(.5)
        & output.snap_pct_last_3.fillna(0).ge(.65)
        & output.snap_share_variance_5.fillna(1).le(.12)
        & changed.eq(0)
        & unavailable.eq(0)
    ).astype(float)
    return output.sort_index()


def snap_base_features() -> list[str]:
    excluded = {name for values in SNAP_FAMILIES.values() for name in values}
    return [name for name in BASE_FEATURES if name not in excluded] + ROLE_FEATURES + ROOM_FEATURES + ROOKIE_FEATURES + AVAILABILITY_BASE + VACANCY + STARTER


def fit_snap_models(train: pd.DataFrame, features: list[str]) -> dict[str, XGBRegressor]:
    models = {}
    for position, rows in train.groupby("historical_position"):
        rows = rows.loc[rows.offensive_snap_pct.notna()]
        if len(rows) >= 100:
            models[position] = model().fit(rows[features], rows.offensive_snap_pct)
    return models


def predict_snap(frame: pd.DataFrame, features: list[str], models: dict[str, XGBRegressor]) -> np.ndarray:
    predicted = np.full(len(frame), np.nan)
    for position, indices in frame.groupby("historical_position").groups.items():
        idx = np.asarray(list(indices), dtype=int)
        if position in models:
            predicted[idx] = np.clip(models[position].predict(frame.loc[idx, features]), 0, 1)
    fallback = pd.to_numeric(frame.snap_pct_last_1, errors="coerce").fillna(
        pd.to_numeric(frame.snap_pct_last_3, errors="coerce")
    ).fillna(0)
    return np.where(np.isfinite(predicted), predicted, fallback)


def build_expanding_snap_predictions(frame: pd.DataFrame, feature_sets: dict[str, list[str]]) -> pd.DataFrame:
    keys = ["player_id", "season", "week"]
    output = frame[keys + ["historical_position", "offensive_snap_pct", "snap_pct_last_1", "snap_pct_last_3"]].copy()
    for name, features in feature_sets.items():
        values = np.full(len(frame), np.nan)
        for year in range(2019, 2026):
            train = frame.loc[frame.season.between(2018, year - 1)]
            validation = frame.loc[frame.season.eq(year)]
            if validation.empty:
                continue
            values[validation.index] = predict_snap(validation.reset_index(drop=True), features, fit_snap_models(train, features))
        values[frame.season.eq(2018)] = frame.loc[frame.season.eq(2018), "snap_pct_last_1"].fillna(0)
        output[f"projected_snap_{name}"] = values
    return output


def snap_metrics(frame: pd.DataFrame, prediction: str) -> dict:
    valid = frame.offensive_snap_pct.notna() & frame[prediction].notna()
    actual = frame.loc[valid, "offensive_snap_pct"].to_numpy(float)
    forecast = frame.loc[valid, prediction].to_numpy(float)
    error = forecast - actual
    report = {
        "rows": int(valid.sum()), "mae": round(float(np.mean(np.abs(error))), 5),
        "bias": round(float(np.mean(error)), 5),
    }
    starter = valid & frame.snap_pct_last_3.fillna(0).ge(.60)
    rising = valid & frame.snap_pct_last_1.sub(frame.snap_pct_last_3).ge(.15)
    falling = valid & frame.snap_pct_last_1.sub(frame.snap_pct_last_3).le(-.15)
    for label, mask in (("starter", starter), ("rising", rising), ("falling", falling)):
        report[f"{label}_rows"] = int(mask.sum())
        report[f"{label}_mae"] = round(float(np.mean(np.abs(frame.loc[mask, prediction] - frame.loc[mask, "offensive_snap_pct"]))), 5) if mask.any() else None
    return report


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
    numeric = set(ROLE_FEATURES + ROOM_FEATURES + ROOKIE_FEATURES + extra + [c for v in SNAP_FAMILIES.values() for c in v])
    for column in numeric:
        if column not in frame:
            frame[column] = 0.0
        frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0)
    frame = add_snap_history(add_relative_room_features(add_actual_shares(frame))).reset_index(drop=True)

    common = list(dict.fromkeys(snap_base_features()))
    feature_sets = {name: list(dict.fromkeys(common + additions)) for name, additions in SNAP_FAMILIES.items()}
    projected = build_expanding_snap_predictions(frame, feature_sets)
    for name in SNAP_FAMILIES:
        frame[f"projected_snap_{name}"] = projected[f"projected_snap_{name}"]
    selection = frame.season.between(2022, 2024)
    snap_validation = {name: snap_metrics(frame.loc[selection], f"projected_snap_{name}") for name in SNAP_FAMILIES}
    best_snap = min(snap_validation, key=lambda name: snap_validation[name]["mae"])
    snap_test = {name: snap_metrics(frame.loc[frame.season.eq(2025)], f"projected_snap_{name}") for name in SNAP_FAMILIES}
    frame["projected_snap_share"] = frame[f"projected_snap_{best_snap}"]
    room = [frame.season, frame.week, frame.team, frame.historical_position]
    frame["projected_snap_room_delta"] = frame.projected_snap_share - frame.projected_snap_share.groupby(room, dropna=False).transform("mean")
    projected.to_csv(PROJECTED_SNAP, index=False, compression="gzip")

    baseline = pd.read_csv(V3_2_ARTIFACT_DIR.parent / "v3_3_2/rolling_validation_predictions.csv.gz", dtype={"player_id": "string"}).rename(columns={"e6_tail_safety_rising_role": "v3_3_2"})
    eligible = baseline[keys + ["historical_position", "v3_3_2"]]
    base_features = BASE_FEATURES + ROLE_FEATURES + ROOM_FEATURES + ROOKIE_FEATURES + AVAILABILITY_BASE + VACANCY + STARTER
    full_additions = [c for c in SNAP_FAMILIES["full"] if c not in base_features]
    variants = {
        "v4_1_baseline": base_features,
        "v4_1_full_snap": base_features + full_additions,
        "v4_2_projected_snap": base_features + ["projected_snap_share", "projected_snap_room_delta"],
        "v4_2_snap_persistence": base_features + ["projected_snap_share", "projected_snap_room_delta", "snap_share_last_8", "snap_share_season_prior", "snap_share_variance_5", "stable_role_prior"],
    }
    window_starts = (2019, 2020)
    folds = []
    for train_end, year in ROLLING_FOLDS:
        print(f"SNAP-first hierarchy fold {year}", flush=True)
        train = frame.loc[frame.season.between(2018, train_end)].reset_index(drop=True)
        validation = frame.loc[frame.season.eq(year)].reset_index(drop=True)
        fold = validation.merge(eligible.loc[eligible.season.eq(year)], on=keys + ["historical_position"], how="inner", validate="one_to_one")
        validation = validation.merge(fold[keys], on=keys, how="inner", validate="one_to_one")
        for name, features in variants.items():
            _, components, ppr, direct = predict(validation, list(dict.fromkeys(features)), fit_models(train, list(dict.fromkeys(features))), 0, target_pass_ratio=.985)
            fold[name] = ppr
            fold[f"_{name}_direct"] = direct
            for column in components:
                fold[f"_{name}_{column}"] = components[column].to_numpy()
            fold[f"ensemble_{name}"] = .6 * fold.v3_3_2 + .4 * fold[name]
        persistence_features = list(dict.fromkeys(variants["v4_2_snap_persistence"]))
        for start_year in window_starts:
            name = f"v4_2_snap_persistence_start_{start_year}"
            window_train = train.loc[train.season.ge(start_year)].reset_index(drop=True)
            _, components, ppr, direct = predict(validation, persistence_features, fit_models(window_train, persistence_features), 0, target_pass_ratio=.985)
            fold[name] = ppr
            fold[f"_{name}_direct"] = direct
            for column in components:
                fold[f"_{name}_{column}"] = components[column].to_numpy()
            fold[f"ensemble_{name}"] = .6 * fold.v3_3_2 + .4 * fold[name]
        folds.append(fold)
    oof = pd.concat(folds, ignore_index=True)
    window_names = [f"v4_2_snap_persistence_start_{year}" for year in window_starts]
    candidates = ["v3_3_2", *variants, *window_names, *(f"ensemble_{name}" for name in [*variants, *window_names])]
    # Stable-role safety weights are selected on 2022–2024 only. They reduce
    # hierarchy influence only when a validated stable role and sharp model
    # disagreement both exist; 2025 remains untouched during selection.
    hierarchy = oof["v4_2_snap_persistence"]
    disagreement = oof.v3_3_2 - hierarchy
    safety_candidates = []
    for stable_weight in (0.0, 0.1, 0.2, 0.3):
        for threshold in (0.5, 1.0, 1.5):
            name = f"stable_safety_w{stable_weight:.1f}_t{threshold:.1f}"
            weights = pd.Series(.4, index=oof.index)
            mask = oof.stable_role_prior.eq(1) & disagreement.gt(threshold)
            weights.loc[mask] = stable_weight
            oof[name] = oof.v3_3_2 + weights * (hierarchy - oof.v3_3_2)
            safety_candidates.append(name)
    candidates += safety_candidates
    pre2025 = oof.season.between(2022, 2024)
    selected_safety = min(safety_candidates, key=lambda name: regression_metrics(oof.loc[pre2025, "fantasy_points_ppr"], oof.loc[pre2025, name])["mae"])
    report = {
        "status": "experimental_local_only", "feature_version": "snap_first_hierarchy_v1",
        "selected_projected_snap_family_pre2025": best_snap,
        "selected_stable_role_safety_pre2025": selected_safety,
        "snap_validation_2022_2024": snap_validation, "snap_test_2025": snap_test,
        "folds": {str(y): {n: regression_metrics(g.fantasy_points_ppr, g[n]) for n in candidates} for y, g in oof.groupby("season")},
        "overall": {n: regression_metrics(oof.fantasy_points_ppr, oof[n]) for n in candidates},
        "positions": {p: {n: regression_metrics(g.fantasy_points_ppr, g[n]) for n in candidates} for p, g in oof.groupby("historical_position")},
        "role_change": {n: role_change_report(oof, n) for n in candidates},
        "opportunity": {n: opportunity_metrics(oof, oof[[f"_{n}_{c}" for c in ["pass_attempts", "rush_attempts", "targets"]]].rename(columns=lambda c: c.removeprefix(f"_{n}_"))) for n in [*variants, *window_names]},
        "feature_counts": {name: len(set(features)) for name, features in variants.items()},
        "runtime_seconds": round(time.perf_counter() - started, 3), "production_unchanged": True,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
    oof.to_csv(OOF, index=False, compression="gzip")
    print(json.dumps({"selected_snap": best_snap, "selected_safety": selected_safety, "snap_validation": snap_validation, "overall": report["overall"]}, indent=2))
    print("No production model or remote projection rows were changed.")


if __name__ == "__main__":
    main()
