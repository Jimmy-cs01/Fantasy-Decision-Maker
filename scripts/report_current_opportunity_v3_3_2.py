#!/usr/bin/env python3
"""Current Week 1 opportunity trace for v3.3.2 and rejected share experiment."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from audit_projection_opportunity_v3_3_2 import finalize
from generate_weekly_projections import resolve_schedule
from generate_weekly_projections_v3_1 import attach_current_context
from generate_weekly_projections_v3_3_1 import current_roles
from projection_pipeline.config import HISTORICAL_STATS_PATH
from projection_pipeline.features import read_historical_stats
from projection_pipeline.v3_1_config import V3_1_PROJECTION_OUTPUT_PATH
from projection_pipeline.v3_1_model import (
    OPPORTUNITY_TARGETS,
    arbitrate_opportunity,
    load_position_models,
    normalize_team_opportunities,
    prediction_dicts,
    predict_coherent_candidate,
)
from projection_pipeline.v3_2_config import SNAP_WEEKLY_PATH, V3_2_ARTIFACT_DIR
from projection_pipeline.v3_2_features import read_snap_weekly, snap_features_for_inference
from projection_pipeline.v3_2_model import role_confidence_with_snaps
from projection_pipeline.v3_3_1_model import apply_current_team_context
from projection_pipeline.v3_3_2_model import PassingHierarchyConfig, passing_allocator
from projection_pipeline.v3_3_2_role_experiment import RoleShareConfig, role_share_allocator
from projection_pipeline.v3_config import PBP_WEEKLY_PATH, V3_FEATURE_DATASET_PATH
from projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/processed/v3_3_2_current_opportunity_audit.json"
NAMES = (
    "Lamar Jackson", "Kenneth Walker III", "Zach Charbonnet", "Jahmyr Gibbs",
    "David Montgomery", "James Cook", "Jonathan Taylor", "Travis Etienne",
    "Breece Hall", "Rachaad White", "Bhayshul Tuten", "Jordan Mason",
    "Chuba Hubbard", "Rashee Rice", "Justin Jefferson", "Jaylen Waddle",
    "Jayden Reed", "George Kittle", "Brock Bowers",
)


def raw_rows(frame, models, features):
    rows: list[dict[str, float] | None] = [None] * len(frame)
    for position, indices in frame.groupby("historical_position", sort=False).groups.items():
        idx = list(indices)
        values = prediction_dicts(models[position], frame.loc[idx].reset_index(drop=True), features[position])
        for original, value in zip(idx, values, strict=True):
            rows[original] = value
    return [row or {} for row in rows]


def arbitrated_rows(frame, raw):
    output = []
    for (_, row), values in zip(frame.iterrows(), raw, strict=True):
        position = str(row.historical_position)
        result = {name: max(0.0, float(value)) for name, value in values.items() if name != "fantasy_points_ppr"}
        for target in OPPORTUNITY_TARGETS[position]:
            if target in result:
                result[target] = arbitrate_opportunity(
                    result[target], row, position, target, role_confidence_with_snaps,
                )
        output.append(result)
    return output


def opportunity(row: dict[str, float], position: str) -> float:
    if position == "QB":
        return float(row.get("pass_attempts", 0))
    if position == "RB":
        return float(row.get("rush_attempts", 0))
    return float(row.get("targets", 0))


def main() -> None:
    historical = read_historical_stats(HISTORICAL_STATS_PATH)
    advanced = read_advanced_weekly(PBP_WEEKLY_PATH)
    schedule = resolve_schedule(None, False)
    base = build_v3_inference_dataset(historical, advanced, 2026, 1, schedule)
    base = apply_current_team_context(base, current_roles(), schedule, 2026, 1)
    inference = attach_current_context(base).reset_index(drop=True)
    snap_history = pd.read_csv(V3_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    inference = snap_features_for_inference(
        inference, snap_history, read_snap_weekly(SNAP_WEEKLY_PATH), 2026, 1,
    ).reset_index(drop=True)
    manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    models = load_position_models(V3_2_ARTIFACT_DIR, {"positions": manifest["models"]})
    features = {position: detail["features"] for position, detail in manifest["models"].items()}
    direct_weights = manifest["direct_weights"]

    production = predict_coherent_candidate(
        inference, models, features, direct_weights,
        role_confidence_fn=role_confidence_with_snaps,
        refill_budget=True, refill_week_one_only=True, current_qb_depth_gate=True,
        robust_week_one_context=True,
        passing_hierarchy_fn=passing_allocator(PassingHierarchyConfig(qb_budget_refill=0.0)),
    )
    production_rising = predict_coherent_candidate(
        inference, models, features, direct_weights,
        role_confidence_fn=role_confidence_with_snaps,
        refill_budget=True, refill_week_one_only=True, current_qb_depth_gate=True,
        robust_week_one_context=True,
        passing_hierarchy_fn=passing_allocator(PassingHierarchyConfig(qb_budget_refill=1.0)),
    )
    experiment_config = RoleShareConfig(
        refill_targets=True, refill_rb_carries=True, qb_rush_archetype_weight=.35,
    )
    experiment = predict_coherent_candidate(
        inference, models, features, direct_weights,
        role_confidence_fn=role_confidence_with_snaps,
        refill_budget=True, refill_week_one_only=True, current_qb_depth_gate=True,
        robust_week_one_context=True,
        passing_hierarchy_fn=role_share_allocator(experiment_config),
    )
    experiment_rising = predict_coherent_candidate(
        inference, models, features, direct_weights,
        role_confidence_fn=role_confidence_with_snaps,
        refill_budget=True, refill_week_one_only=True, current_qb_depth_gate=True,
        robust_week_one_context=True,
        passing_hierarchy_fn=role_share_allocator(RoleShareConfig(
            **{**experiment_config.__dict__, "qb_environment_refill": 1.0},
        )),
    )
    v31 = pd.read_csv(V3_1_PROJECTION_OUTPUT_PATH, dtype={"gsis_id": "string"}).set_index("gsis_id")
    baseline = inference.player_id.map(v31.model_projection_ppr).fillna(pd.Series(production.predictions)).to_numpy(float)
    production_ppr, production_components = finalize(inference, production, production_rising, baseline)
    experiment_ppr, experiment_components = finalize(inference, experiment, experiment_rising, baseline)

    raw = raw_rows(inference, models, features)
    arbitrated = arbitrated_rows(inference, raw)
    normalized, normalized_audit = normalize_team_opportunities(
        inference, arbitrated, role_confidence_with_snaps,
        refill_budget=True, refill_week_one_only=True, current_qb_depth_gate=True,
        robust_week_one_context=True,
    )
    passing, _ = passing_allocator(PassingHierarchyConfig(qb_budget_refill=0.0))(
        inference, normalized, normalized_audit, role_confidence_with_snaps,
    )

    records = []
    for index, player in inference.iterrows():
        position = str(player.historical_position)
        records.append({
            "player_id": player.player_id, "player": player.get("player_name"),
            "team": player.get("team"), "position": position,
            "depth_position": player.get("depth_position"), "depth_rank": player.get("depth_rank"),
            "raw_opportunity": opportunity(raw[index], position),
            "after_role_arbitration": opportunity(arbitrated[index], position),
            "after_team_ceiling": opportunity(normalized[index], position),
            "after_passing_hierarchy": opportunity(passing[index], position),
            "v3_3_2_pass_attempts": production_components[index].get("pass_attempts", 0),
            "v3_3_2_carries": production_components[index].get("rush_attempts", 0),
            "v3_3_2_targets": production_components[index].get("targets", 0),
            "v3_3_2_ppr": production_ppr[index],
            "experiment_pass_attempts": experiment_components[index].get("pass_attempts", 0),
            "experiment_carries": experiment_components[index].get("rush_attempts", 0),
            "experiment_targets": experiment_components[index].get("targets", 0),
            "experiment_ppr": experiment_ppr[index],
            "ppr_delta": experiment_ppr[index] - production_ppr[index],
            "recent_l3": player.get("pbp_pass_attempts_l3") if position == "QB" else (
                player.get("pbp_touches_l3") if position == "RB" else player.get("pbp_targets_l3")
            ),
            "snap_last_1": player.get("snap_pct_last_1"),
        })
    current = pd.DataFrame(records)
    named = current.loc[current.player.isin(NAMES)].copy()
    teams = set(named.team.dropna())
    rooms = current.loc[current.team.isin(teams) & current.position.isin(["QB", "RB", "WR", "TE"])]
    report = {
        "status": "diagnostic_only_rejected_experiment",
        "pipeline": [
            "raw position XGBoost components", "sample/history role arbitration",
            "team opportunity ceilings", "QB-attempt then target hierarchy",
            "red-zone and efficiency derivation", "protective PPR correction",
            "exact component reconciliation", "Vegas PPR arbitration (remote; opportunity unchanged)",
        ],
        "named_players": named.replace({np.nan: None}).to_dict("records"),
        "largest_changes": current.reindex(current.ppr_delta.abs().sort_values(ascending=False).index).head(25).replace({np.nan: None}).to_dict("records"),
        "relevant_team_rooms": rooms.replace({np.nan: None}).to_dict("records"),
        "production_team_audit": production.audit.replace({np.nan: None}).to_dict("records"),
        "experiment_team_audit": experiment.audit.replace({np.nan: None}).to_dict("records"),
        "production_unchanged": True,
    }
    OUTPUT.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(f"Current opportunity audit: {OUTPUT}")
    print("No Supabase, Vercel, environment, or active-model changes were made.")


if __name__ == "__main__":
    main()
