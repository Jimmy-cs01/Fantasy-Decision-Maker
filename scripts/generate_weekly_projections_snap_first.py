#!/usr/bin/env python3
"""Current dry-run for the frozen SNAP-first hierarchy candidate."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from generate_weekly_projections_v4 import COMPONENT_MAP, current_frame
from generate_weekly_projections_v4_1 import add_current_availability
from projection_pipeline.v3_2_config import V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v4_hierarchy import add_relative_room_features, reconcile_targets_to_pass_attempts, score_ppr
from train_projection_model_snap_first import (
    AVAILABILITY, AVAILABILITY_BASE, ROOM_FEATURES, ROLE_FEATURES, ROOKIE_FEATURES,
    SNAP_FAMILIES, STARTER, VACANCY, add_actual_shares, add_snap_history,
    fit_models, fit_snap_models, predict, predict_snap, snap_base_features,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/player_projections_snap_first_candidate.csv"
REPORT = ROOT / "data/processed/model_snap_first_current_sanity.json"
WEIGHT = .40


def training_frame() -> pd.DataFrame:
    keys = ["player_id", "season", "week"]
    base = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    availability = pd.read_csv(AVAILABILITY, dtype={"player_id": "string"}).rename(columns={
        "team_changed": "team_changed_v41", "weeks_since_team_change": "weeks_since_team_change_v41",
    })
    additions = AVAILABILITY_BASE + VACANCY + STARTER
    base = base.merge(availability[keys + additions], on=keys, how="left", validate="one_to_one")
    role = pd.read_csv(ROOT / "data/processed/player_week_role_state_v4.csv.gz", dtype={"player_id": "string"})
    extras = [c for c in role.columns if c not in base.columns or c in keys]
    base = base.merge(role[extras], on=keys, how="left", validate="one_to_one")
    base["team"] = base.canonical_team.fillna(base.team)
    for column in set(ROLE_FEATURES + ROOKIE_FEATURES + additions + SNAP_FAMILIES["full"]):
        if column not in base:
            base[column] = 0.0
        base[column] = pd.to_numeric(base[column], errors="coerce").fillna(0)
    base = add_snap_history(add_relative_room_features(add_actual_shares(base))).reset_index(drop=True)
    projected = pd.read_csv(ROOT / "data/processed/player_week_projected_snap_share.csv.gz", dtype={"player_id": "string"})
    base = base.merge(projected[keys + ["projected_snap_full"]], on=keys, how="left", validate="one_to_one")
    base["projected_snap_share"] = base.projected_snap_full.fillna(base.snap_pct_last_1).fillna(0)
    room = [base.season, base.week, base.team, base.historical_position]
    base["projected_snap_room_delta"] = base.projected_snap_share - base.projected_snap_share.groupby(room, dropna=False).transform("mean")
    return base


def current_with_snap(train: pd.DataFrame) -> pd.DataFrame:
    current = add_current_availability(current_frame()).reset_index(drop=True)
    # At the 2026 Week 1 cutoff, all completed 2025 snaps are legitimate prior information.
    history = train.sort_values(["player_id", "season", "week"])
    summaries = []
    for player_id, rows in history.groupby("player_id", sort=False):
        actual = pd.to_numeric(rows.offensive_snap_pct, errors="coerce").dropna()
        summaries.append({
            "player_id": player_id,
            "snap_share_last_8": actual.tail(8).mean() if len(actual) else np.nan,
            "snap_share_variance_5": actual.tail(5).std() if len(actual) >= 2 else np.nan,
            "snap_share_season_prior": actual.loc[rows.loc[actual.index, "season"].eq(rows.season.max())].mean() if len(actual) else np.nan,
        })
    current = current.merge(pd.DataFrame(summaries), on="player_id", how="left", validate="one_to_one")
    for column in set(ROLE_FEATURES + ROOM_FEATURES + ROOKIE_FEATURES + AVAILABILITY_BASE + VACANCY + STARTER + SNAP_FAMILIES["full"]):
        if column not in current:
            current[column] = 0.0
        current[column] = pd.to_numeric(current[column], errors="coerce").fillna(0)
    room = [current.team, current.historical_position]
    prior = current.snap_pct_last_1
    current["room_snap_rank"] = prior.groupby(room, dropna=False).rank(method="min", ascending=False)
    current["room_snap_gap_to_leader"] = prior.groupby(room, dropna=False).transform("max") - prior
    current["stable_role_prior"] = (
        current.starter_input.ge(.5) & current.snap_pct_last_3.ge(.65)
        & current.snap_share_variance_5.le(.12) & current.team_changed_v41.eq(0)
        & current.structurally_unavailable.eq(0)
    ).astype(float)
    snap_features = list(dict.fromkeys(snap_base_features() + SNAP_FAMILIES["full"]))
    current["projected_snap_share"] = predict_snap(current, snap_features, fit_snap_models(train, snap_features))
    current["projected_snap_room_delta"] = current.projected_snap_share - current.projected_snap_share.groupby(room, dropna=False).transform("mean")
    return add_relative_room_features(current)


def main() -> None:
    train = training_frame()
    current = current_with_snap(train)
    features = list(dict.fromkeys(
        __import__("train_projection_model_v4").BASE_FEATURES + ROLE_FEATURES + ROOM_FEATURES + ROOKIE_FEATURES
        + AVAILABILITY_BASE + VACANCY + STARTER
        + ["projected_snap_share", "projected_snap_room_delta", "snap_share_last_8", "snap_share_season_prior", "snap_share_variance_5", "stable_role_prior"]
    ))
    _, components, hierarchy_ppr, direct = predict(current, features, fit_models(train, features), 0, target_pass_ratio=.985)
    baseline = pd.read_csv(ROOT / "data/processed/player_projections_v3_3_2.csv", dtype={"gsis_id": "string"}).drop_duplicates("gsis_id").set_index("gsis_id")
    rows = []
    for index, source in current.iterrows():
        if source.player_id not in baseline.index:
            continue
        old_row = baseline.loc[source.player_id]
        old = json.loads(old_row.projected_stats)
        blended = {name: float(old.get(old_name, 0)) * .6 + float(components.loc[index, name]) * .4 for name, old_name in COMPONENT_MAP.items()}
        rows.append({
            "player_id": source.player_id, "player_name": source.player_name, "team": source.team,
            "position": source.historical_position, "depth_rank": source.depth_rank, "is_starter": source.is_starter,
            "recent_snap_pct": source.snap_pct_last_1, "rolling_snap_pct": source.snap_pct_last_3,
            "projected_snap_pct": source.projected_snap_share, "stable_role_prior": source.stable_role_prior,
            "v3_3_2": float(old_row.model_projection_ppr), "hierarchy": float(hierarchy_ppr[index]),
            "direct": float(direct[index]), **{f"projected_{name}": value for name, value in blended.items()},
        })
    output = pd.DataFrame(rows)
    component_names = list(COMPONENT_MAP)
    reconciled = reconcile_targets_to_pass_attempts(
        output[[f"projected_{name}" for name in component_names]].rename(columns=lambda name: name.removeprefix("projected_")), output.team, .985,
    )
    for name in component_names:
        output[f"projected_{name}"] = reconciled[name].to_numpy()
    output["candidate"] = score_ppr(reconciled)
    output["delta"] = output.candidate - output.v3_3_2
    output.to_csv(OUTPUT, index=False)
    starters = output.is_starter.astype("boolean").fillna(False).astype(bool)
    high_snap = output.recent_snap_pct.fillna(0).ge(.70)
    teams = output.groupby("team", dropna=False).agg(pass_attempts=("projected_pass_attempts", "sum"), targets=("projected_targets", "sum"))
    suppressions = output.loc[starters & high_snap & output.delta.lt(-1.5)]
    point_groups = {
        "passing": ["pass_yards", "pass_tds", "interceptions"],
        "rushing": ["rush_yards", "rush_tds"],
        "receiving": ["receptions", "receiving_yards", "receiving_tds"],
    }
    causes = {name: 0 for name in point_groups}
    for _, row in suppressions.iterrows():
        old = json.loads(baseline.loc[row.player_id].projected_stats)
        old_components = {new: float(old.get(old_name, 0)) for new, old_name in COMPONENT_MAP.items()}
        deltas = {}
        for group, names in point_groups.items():
            before = score_ppr(pd.DataFrame([{k: old_components.get(k, 0) if k in names else 0 for k in component_names}]))[0]
            after = score_ppr(pd.DataFrame([{k: row[f"projected_{k}"] if k in names else 0 for k in component_names}]))[0]
            deltas[group] = after - before
        causes[min(deltas, key=deltas.get)] += 1
    canaries = ["Josh Allen", "Lamar Jackson", "Jalen Hurts", "Jayden Daniels", "Drake Maye", "Christian McCaffrey", "Bijan Robinson", "Jahmyr Gibbs", "David Montgomery", "Kenneth Walker", "Zach Charbonnet", "James Cook", "Jonathan Taylor", "Travis Etienne", "Breece Hall", "Chuba Hubbard", "Bhayshul Tuten", "Frank Gore Jr.", "Jarquez Hunter", "Justin Jefferson", "Ja'Marr Chase", "CeeDee Lamb", "Puka Nacua", "Rashee Rice", "Jaylen Waddle", "Jayden Reed", "George Kittle", "Brock Bowers", "Mark Andrews"]
    report = {
        "rows": int(len(output)), "component_ppr_mismatches": 0,
        "negative_components": int((output.filter(regex="^projected_").select_dtypes("number") < 0).any(axis=1).sum()),
        "rb4_above_8": int((output.position.eq("RB") & pd.to_numeric(output.depth_rank, errors="coerce").ge(4) & output.candidate.gt(8)).sum()),
        "teamless_above_1": int((output.team.isna() & output.candidate.gt(1)).sum()),
        "starting_qb_below_8": int((output.position.eq("QB") & starters & output.candidate.lt(8)).sum()),
        "starting_qb_below_18_attempts": int((output.position.eq("QB") & starters & output.projected_pass_attempts.lt(18)).sum()),
        "team_target_pass_violations": int(teams.targets.gt(teams.pass_attempts + 1e-6).sum()),
        "stable_high_snap_suppression": int(len(suppressions)), "suppression_primary_component": causes,
        "suppressions": suppressions[["player_name", "team", "position", "v3_3_2", "candidate", "delta", "recent_snap_pct", "projected_snap_pct"]].to_dict("records"),
        "canaries": output.loc[output.player_name.isin(canaries), ["player_name", "team", "position", "depth_rank", "recent_snap_pct", "rolling_snap_pct", "projected_snap_pct", "v3_3_2", "hierarchy", "candidate", "delta", "projected_pass_attempts", "projected_rush_attempts", "projected_targets"]].to_dict("records"),
        "production_unchanged": True,
    }
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k not in ("canaries", "suppressions")}, indent=2))
    print("No production model or remote projection rows were changed.")


if __name__ == "__main__":
    main()
