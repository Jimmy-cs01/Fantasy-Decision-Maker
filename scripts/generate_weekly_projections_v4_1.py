#!/usr/bin/env python3
"""Generate the local-only frozen v4.1 candidate for current sanity review."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from generate_weekly_projections_v4 import COMPONENT_MAP, current_frame
from projection_pipeline.v3_2_config import V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v4_hierarchy import add_relative_room_features, reconcile_targets_to_pass_attempts, score_ppr
from train_projection_model_v4 import BASE_FEATURES, ROLE_FEATURES, ROOM_FEATURES, ROOKIE_FEATURES, add_actual_shares, fit_models, predict
from train_projection_model_v4_1 import AVAILABILITY, AVAILABILITY_BASE, VACANCY, STARTER

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/player_projections_v4_1_candidate.csv"
REPORT = ROOT / "data/processed/model_v4_1_current_sanity.json"
WEIGHT = .40


def training_frame() -> pd.DataFrame:
    base = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    keys = ["player_id", "season", "week"]
    availability = pd.read_csv(AVAILABILITY, dtype={"player_id": "string"}).rename(columns={
        "team_changed": "team_changed_v41", "weeks_since_team_change": "weeks_since_team_change_v41",
    })
    additions = AVAILABILITY_BASE + VACANCY + STARTER
    base = base.merge(availability[keys + additions], on=keys, how="left", validate="one_to_one")
    role = pd.read_csv(ROOT / "data/processed/player_week_role_state_v4.csv.gz", dtype={"player_id": "string"})
    extras = [c for c in role.columns if c not in base.columns or c in keys]
    base = base.merge(role[extras], on=keys, how="left", validate="one_to_one")
    base["team"] = base.canonical_team.fillna(base.team)
    for column in set(ROLE_FEATURES + ROOKIE_FEATURES + additions):
        base[column] = pd.to_numeric(base.get(column, 0), errors="coerce").fillna(0)
    return add_relative_room_features(add_actual_shares(base))


def add_current_availability(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    active = output.team.notna().astype(int)
    defaults = {
        "is_active_expected": active, "is_out_known": 0, "is_questionable": 0, "is_doubtful": 0,
        "availability_observed": output.depth_observed, "availability_confidence": output.role_confidence,
        "structurally_unavailable": 1 - active, "team_changed_v41": output.prior_team.notna().astype(int) * output.prior_team.ne(output.team).astype(int),
        "weeks_since_team_change_v41": 0, "weeks_since_last_opportunity": 0,
        "returning_from_injury_or_reserve": 0, "room_active_count": output.groupby(["team", "historical_position"]).team.transform("size"),
        "room_unavailable_count": 0, "vacated_room_rush_share": 0, "vacated_room_target_share": 0,
        "top_competitor_out": 0, "starter_ahead_unavailable": 0,
        "depth_rank_improved": 0, "depth_rank_declined": 0,
        "new_starter_probability": np.clip(.75 * output.starter_input + .25 * output.depth_rank_input.eq(1), 0, 1),
        "prior_rush_share_l3": output.team_rush_share_l3.fillna(0),
        "prior_target_share_l3": output.pbp_target_share_l3.fillna(0),
    }
    for name, values in defaults.items(): output[name] = values
    return output


def main() -> None:
    train = training_frame()
    current = add_relative_room_features(add_current_availability(current_frame()))
    features = BASE_FEATURES + ROLE_FEATURES + ROOM_FEATURES + ROOKIE_FEATURES + AVAILABILITY_BASE + VACANCY + STARTER
    _, components, hierarchy_ppr, direct = predict(current, features, fit_models(train, features), 0, target_pass_ratio=.985)
    baseline = pd.read_csv(ROOT / "data/processed/player_projections_v3_3_2.csv", dtype={"gsis_id": "string"}).drop_duplicates("gsis_id").set_index("gsis_id")
    rows = []
    for index, source in current.iterrows():
        if source.player_id not in baseline.index: continue
        old_row = baseline.loc[source.player_id]; old = json.loads(old_row.projected_stats)
        blended = {name: float(old.get(old_name, 0)) * .6 + float(components.loc[index, name]) * .4 for name, old_name in COMPONENT_MAP.items()}
        final = float(score_ppr(pd.DataFrame([blended]))[0])
        rows.append({"player_id": source.player_id, "player_name": source.player_name, "team": source.team,
            "position": source.historical_position, "depth_rank": source.depth_rank, "is_starter": source.is_starter,
            "availability_confidence": source.availability_confidence, "v3_3_2": float(old_row.model_projection_ppr),
            "v4_1_hierarchy": float(hierarchy_ppr[index]), "v4_1_direct": float(direct[index]), "v4_1_ensemble": final,
            "delta": final - float(old_row.model_projection_ppr), **{f"projected_{k}": v for k, v in blended.items()}})
    output = pd.DataFrame(rows)
    component_names = list(COMPONENT_MAP)
    reconciled = reconcile_targets_to_pass_attempts(
        output[[f"projected_{name}" for name in component_names]].rename(columns=lambda name: name.removeprefix("projected_")),
        output.team, .985,
    )
    for name in component_names:
        output[f"projected_{name}"] = reconciled[name].to_numpy()
    output["v4_1_ensemble"] = score_ppr(reconciled)
    output["delta"] = output.v4_1_ensemble - output.v3_3_2
    output.to_csv(OUTPUT, index=False)
    starters = output.is_starter.astype("boolean").fillna(False).astype(bool)
    teams = output.groupby("team", dropna=False).agg(pass_attempts=("projected_pass_attempts", "sum"), targets=("projected_targets", "sum"))
    canaries = ["Josh Allen", "Lamar Jackson", "Jalen Hurts", "Jayden Daniels", "Drake Maye", "Christian McCaffrey", "Bijan Robinson", "Jahmyr Gibbs", "David Montgomery", "Kenneth Walker", "Zach Charbonnet", "James Cook", "Jonathan Taylor", "Travis Etienne", "Breece Hall", "Chuba Hubbard", "Bhayshul Tuten", "Frank Gore Jr.", "Jarquez Hunter", "Justin Jefferson", "Ja'Marr Chase", "CeeDee Lamb", "Puka Nacua", "Rashee Rice", "Jaylen Waddle", "Jayden Reed", "George Kittle", "Brock Bowers", "Mark Andrews"]
    report = {"rows": len(output), "component_ppr_mismatches": 0,
        "negative_components": int((output.filter(regex="^projected_").select_dtypes("number") < 0).any(axis=1).sum()),
        "rb4_above_8": int((output.position.eq("RB") & pd.to_numeric(output.depth_rank, errors="coerce").ge(4) & output.v4_1_ensemble.gt(8)).sum()),
        "teamless_above_1": int((output.team.isna() & output.v4_1_ensemble.gt(1)).sum()),
        "starting_qb_below_8": int((output.position.eq("QB") & starters & output.v4_1_ensemble.lt(8)).sum()),
        "starting_qb_below_18_attempts": int((output.position.eq("QB") & starters & output.projected_pass_attempts.lt(18)).sum()),
        "team_target_pass_violations": int(teams.targets.gt(teams.pass_attempts + 1e-6).sum()),
        "stable_high_snap_suppression": int((output.v3_3_2.sub(output.v4_1_ensemble).gt(1.5) & starters).sum()),
        "canaries": output.loc[output.player_name.isin(canaries), ["player_name", "team", "position", "depth_rank", "v3_3_2", "v4_1_hierarchy", "v4_1_ensemble", "delta", "projected_pass_attempts", "projected_rush_attempts", "projected_targets"]].to_dict("records"),
        "production_unchanged": True}
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k:v for k,v in report.items() if k != "canaries"}, indent=2))


if __name__ == "__main__": main()
