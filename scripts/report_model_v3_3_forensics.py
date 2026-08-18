#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from generate_weekly_projections import resolve_schedule
from generate_weekly_projections_v3_1 import attach_current_context
from projection_pipeline.config import DIRECT_TARGET, HISTORICAL_STATS_PATH
from projection_pipeline.features import read_historical_stats
from projection_pipeline.scoring import score_projected_stats_exact
from projection_pipeline.v3_1_model import (
    OPPORTUNITY_TARGETS,
    arbitrate_opportunity,
    load_position_models,
    prediction_dicts,
    role_confidence,
    sample_weight,
)
from projection_pipeline.v3_2_config import SNAP_WEEKLY_PATH, V3_2_ARTIFACT_DIR, V3_2_FEATURE_DATASET_PATH
from projection_pipeline.v3_2_features import read_snap_weekly, snap_features_for_inference
from projection_pipeline.v3_2_model import role_confidence_with_snaps, snap_role_signal
from projection_pipeline.v3_3_1_model import apply_current_team_context
from projection_pipeline.v3_config import PBP_WEEKLY_PATH
from projection_pipeline.v3_features import build_v3_inference_dataset, read_advanced_weekly

REPORT_PATH = Path("data/processed/model_v3_3_forensic_report.json")
QB_AUDIT_PATH = Path("data/processed/model_v3_3_qb_audit.csv")


def clean(value):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, (np.integer, np.floating)):
        return value.item()
    return value


def age_on_week_one(value) -> float | None:
    if pd.isna(value):
        return None
    born = pd.Timestamp(value).date()
    kickoff = date(2026, 9, 10)
    return round((kickoff - born).days / 365.2425, 2)


def efficiency(stats: dict[str, float]) -> dict[str, float | None]:
    def ratio(top: str, bottom: str):
        return clean(stats.get(top, 0) / stats[bottom]) if stats.get(bottom, 0) > 0 else None
    return {
        "completion_rate": ratio("completions", "pass_attempts"),
        "passing_yards_per_attempt": ratio("passing_yards", "pass_attempts"),
        "rushing_yards_per_attempt": ratio("rushing_yards", "rush_attempts"),
        "catch_rate": ratio("receptions", "targets"),
        "receiving_yards_per_target": ratio("receiving_yards", "targets"),
        "passing_td_per_red_zone_attempt": ratio("passing_touchdowns", "red_zone_pass_attempts"),
        "rushing_td_per_red_zone_carry": ratio("rushing_touchdowns", "red_zone_carries"),
        "receiving_td_per_red_zone_target": ratio("receiving_touchdowns", "red_zone_targets"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Forensic v3.3 current-inference audit; local and read-only.")
    parser.add_argument("--player", action="append", default=[])
    args = parser.parse_args()
    historical = read_historical_stats(HISTORICAL_STATS_PATH)
    advanced = read_advanced_weekly(PBP_WEEKLY_PATH)
    schedule = resolve_schedule(None, False)
    inference = attach_current_context(
        build_v3_inference_dataset(historical, advanced, 2026, 1, schedule),
    ).reset_index(drop=True)
    training = pd.read_csv(V3_2_FEATURE_DATASET_PATH, dtype={"player_id": "string", "team": "string"})
    inference = snap_features_for_inference(
        inference, training, read_snap_weekly(SNAP_WEEKLY_PATH), 2026, 1,
    ).reset_index(drop=True)
    depth = pd.read_csv("data/processed/depth_chart_roles.csv", dtype={"gsis_id": "string"})
    current_roles = depth.sort_values(["season", "source_updated_at", "fetched_at"]).groupby("gsis_id", as_index=False).tail(1)
    current_roles = current_roles[["gsis_id", "team"]].rename(columns={"gsis_id": "player_id"})
    corrected_inference = apply_current_team_context(inference, current_roles, schedule, 2026, 1)
    moved = corrected_inference["prior_team"].ne(corrected_inference["team"])
    corrected_inference.loc[moved, "snap_prior_same_team"] = 0.0
    manifest = json.loads((V3_2_ARTIFACT_DIR / "manifest.json").read_text())
    models = load_position_models(V3_2_ARTIFACT_DIR, {"positions": manifest["models"]})
    features = {position: detail["features"] for position, detail in manifest["models"].items()}

    raw_rows: list[dict[str, float] | None] = [None] * len(inference)
    for position, indices in inference.groupby("historical_position").groups.items():
        idx = list(indices)
        raw = prediction_dicts(models[position], inference.loc[idx].reset_index(drop=True), features[position])
        for original, values in zip(idx, raw, strict=True):
            raw_rows[original] = values

    from projection_pipeline.v3_1_model import predict_coherent_candidate
    legacy = predict_coherent_candidate(
        inference, models, features, manifest["direct_weights"],
        role_confidence_fn=role_confidence_with_snaps,
    )
    candidate = predict_coherent_candidate(
        corrected_inference, models, features, manifest["direct_weights"],
        role_confidence_fn=role_confidence_with_snaps,
        refill_budget=True,
        refill_week_one_only=True,
        current_qb_depth_gate=True,
        robust_week_one_context=True,
    )
    comparison = pd.read_csv("data/processed/model_v3_3_comparison.csv", dtype={"gsis_id": "string"}).set_index("gsis_id")
    reconciliation_path = Path("data/processed/projection_reconciliation_report.json")
    reconciled = {}
    if reconciliation_path.exists():
        reconciled = {row["gsis_id"]: row for row in json.loads(reconciliation_path.read_text()).get("rows", [])}

    requested = args.player or [
        "Lamar Jackson", "Josh Allen", "Christian McCaffrey", "Jahmyr Gibbs",
        "Justin Jefferson", "Ja'Marr Chase", "Trey McBride", "Brock Bowers",
        "Colston Loveland", "Marvin Harrison", "Michael Wilson", "Brian Thomas",
        "Parker Washington", "Terry McLaurin", "Stefon Diggs", "Frank Gore Jr.",
        "Jarquez Hunter", "Bhayshul Tuten", "Chris Rodriguez",
    ]
    selected = inference.loc[inference["player_name"].fillna("").apply(
        lambda name: any(token.lower() in name.lower() for token in requested)
    )]
    traces = []
    important_core = {
        "QB": ["pass_attempts_l3", "pass_attempts_l5", "pbp_pass_attempts_l3", "pbp_pass_attempts_l5", "pbp_pass_attempts_l8", "team_offensive_plays_l3", "team_offensive_plays_l5", "team_offensive_plays_l8", "team_pass_rate_l3", "team_pass_rate_l5", "team_pass_rate_l8", "red_zone_pass_attempts_l3", "red_zone_pass_attempts_l5", "red_zone_pass_attempts_l8"],
        "RB": ["rush_attempts_l3", "rush_attempts_l5", "targets_l3", "targets_l5", "pbp_touches_l3", "pbp_touches_l5", "pbp_touches_l8"],
        "WR": ["targets_l3", "targets_l5", "pbp_targets_l3", "pbp_targets_l5", "pbp_targets_l8", "target_share_l3"],
        "TE": ["targets_l3", "targets_l5", "pbp_targets_l3", "pbp_targets_l5", "pbp_targets_l8", "target_share_l3"],
    }
    for index, row in selected.iterrows():
        position = str(row.historical_position)
        raw = raw_rows[index] or {}
        pre = dict(raw)
        for target in OPPORTUNITY_TARGETS[position]:
            if target in pre:
                pre[target] = arbitrate_opportunity(
                    pre[target], row, position, target, role_confidence_with_snaps,
                )
        train_position = training.loc[training.historical_position.eq(position)]
        feature_distribution = {}
        direct_model = models[position][DIRECT_TARGET]
        importance = dict(zip(features[position], direct_model.feature_importances_, strict=True))
        distribution_features = list(dict.fromkeys([
            *important_core[position], "snap_pct_last_1", "snap_history_available",
            *sorted(features[position], key=lambda name: importance[name], reverse=True)[:12],
        ]))
        for feature in distribution_features:
            values = pd.to_numeric(train_position[feature], errors="coerce").dropna()
            current = row.get(feature)
            feature_distribution[feature] = {
                "current": clean(current),
                "missing": bool(pd.isna(current)),
                "training_mean": clean(values.mean()) if len(values) else None,
                "training_median": clean(values.median()) if len(values) else None,
                "training_percentile": clean((values <= float(current)).mean()) if len(values) and pd.notna(current) else None,
            }
        legacy_stats = legacy.components[index]
        candidate_stats = candidate.components[index]
        old = comparison.loc[row.player_id] if row.player_id in comparison.index else None
        remote = reconciled.get(str(row.player_id), {})
        trace = {
            "identity": {
                "canonical_player_id": str(row.player_id), "player": clean(row.get("player_name")),
                "age": age_on_week_one(row.get("birth_date")), "team": clean(row.get("team")),
                "candidate_current_team": clean(corrected_inference.loc[index].get("team")),
                "position": position, "depth_rank": clean(row.get("depth_rank")),
                "starter": bool(row.get("is_starter", False)), "prior_nfl_games": clean(row.get("career_games_before")),
                "recent_snap_pct": clean(row.get("snap_pct_last_1")), "rolling_snap_pct": clean(row.get("snap_pct_last_3")),
                "role_confidence_without_snaps": role_confidence(row, position),
                "snap_role_signal": snap_role_signal(row, position),
                "role_confidence": role_confidence_with_snaps(row, position),
            },
            "sample_weight": sample_weight(row, position),
            "history": {key: clean(row.get(key)) for key in [
                "pass_attempts_l3", "pass_attempts_l5", "pbp_pass_attempts_l3", "pbp_pass_attempts_l5", "pbp_pass_attempts_l8",
                "rush_attempts_l3", "rush_attempts_l5", "targets_l3", "targets_l5", "pbp_targets_l3", "pbp_targets_l5", "pbp_targets_l8",
                "pbp_touches_l3", "pbp_touches_l5", "pbp_touches_l8", "prior_season_games", "prior_season_ppr_ppg",
                "prior_season_position_rank_pct", "snap_prior_same_team", "snap_prior_same_season",
            ]},
            "team_budget_v3_3": legacy.audit.loc[legacy.audit.team.eq(row.team)].iloc[0].to_dict() if pd.notna(row.team) else {},
            "team_budget_candidate": candidate.audit.loc[candidate.audit.team.eq(corrected_inference.loc[index].team)].iloc[0].to_dict() if pd.notna(corrected_inference.loc[index].team) else {},
            "raw_model_components": {key: clean(value) for key, value in raw.items()},
            "pre_normalization_opportunity": {key: clean(pre.get(key)) for key in ["pass_attempts", "rush_attempts", "targets"]},
            "post_normalization_v3_3": {key: clean(legacy_stats.get(key)) for key in ["pass_attempts", "rush_attempts", "targets", "red_zone_pass_attempts", "red_zone_carries", "red_zone_targets"]},
            "post_normalization_candidate": {key: clean(candidate_stats.get(key)) for key in ["pass_attempts", "rush_attempts", "targets", "red_zone_pass_attempts", "red_zone_carries", "red_zone_targets"]},
            "efficiency_v3_3": efficiency(legacy_stats),
            "components_v3_3": {key: clean(value) for key, value in legacy_stats.items()},
            "components_candidate": {key: clean(value) for key, value in candidate_stats.items()},
            "direct_ppr": clean(legacy.direct[index]),
            "component_ppr_v3_3": score_projected_stats_exact(legacy_stats, {"rec": 1.0}, position),
            "component_ppr_candidate": score_projected_stats_exact(candidate_stats, {"rec": 1.0}, position),
            "v3_1": clean(old.get("v3_1")) if old is not None else None,
            "v3_2": clean(old.get("v3_2")) if old is not None else None,
            "v3_3_raw": clean(old.get("v3_3")) if old is not None else None,
            "vegas": clean(remote.get("vegas_ppr")), "reconciled_final": clean(remote.get("final_ppr")),
            "feature_distribution": feature_distribution,
        }
        traces.append(trace)

    schema = {}
    missingness = {}
    for position in ("QB", "RB", "WR", "TE"):
        expected = features[position]
        booster_names = models[position][DIRECT_TARGET].get_booster().feature_names or []
        schema[position] = {
            "feature_count": len(expected),
            "missing_training_columns": sorted(set(expected) - set(training.columns)),
            "missing_inference_columns": sorted(set(expected) - set(inference.columns)),
            "model_feature_order_exact": booster_names == expected,
        }
        train_week_one = training.loc[training.historical_position.eq(position) & training.week.eq(1)]
        current = inference.loc[inference.historical_position.eq(position)]
        material = []
        for feature in expected:
            historical_missing = float(train_week_one[feature].isna().mean()) if len(train_week_one) else 0
            current_missing = float(current[feature].isna().mean()) if len(current) else 0
            if abs(current_missing - historical_missing) >= 0.20:
                material.append({"feature": feature, "historical_week1": historical_missing, "current_week1": current_missing})
        missingness[position] = material

    qb_rows = []
    for index, row in inference.loc[inference.historical_position.eq("QB")].iterrows():
        qb_rows.append({
            "player": row.get("player_name"), "team": row.get("team"), "depth_rank": row.get("depth_rank"),
            "starter": row.get("is_starter"), "recent_snap_pct": row.get("snap_pct_last_1"),
            "v3_3_pass_attempts": legacy.components[index].get("pass_attempts"),
            "candidate_pass_attempts": candidate.components[index].get("pass_attempts"),
            "v3_3_rush_attempts": legacy.components[index].get("rush_attempts"),
            "v3_3_raw_ppr": comparison.loc[row.player_id, "v3_3"] if row.player_id in comparison.index else None,
            "reconciled_final": reconciled.get(str(row.player_id), {}).get("final_ppr"),
        })
    qb_audit = pd.DataFrame(qb_rows).sort_values("v3_3_pass_attempts")
    QB_AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    qb_audit.to_csv(QB_AUDIT_PATH, index=False)

    established = comparison.loc[comparison.established_starter.astype(bool)].copy()
    floor_hit = established.loc[established.v3_2.lt(established.v3_1 - 1.25)].copy()
    floor_hit["adjustment"] = (floor_hit.v3_1 - 1.25) - floor_hit.v3_2
    report = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "schema_parity": schema,
        "material_missingness_differences_vs_historical_week1": missingness,
        "snap_scale": {
            "raw_normalized_min": clean(read_snap_weekly(SNAP_WEEKLY_PATH).offensive_snap_pct.min()),
            "raw_normalized_max": clean(read_snap_weekly(SNAP_WEEKLY_PATH).offensive_snap_pct.max()),
            "training_min": clean(training.snap_pct_last_1.min()), "training_max": clean(training.snap_pct_last_1.max()),
            "inference_min": clean(inference.snap_pct_last_1.min()), "inference_max": clean(inference.snap_pct_last_1.max()),
        },
        "established_starter_floor": {
            "eligible": int(len(established)), "hit": int(len(floor_hit)),
            "average_adjustment": clean(floor_hit.adjustment.mean()), "largest_adjustment": clean(floor_hit.adjustment.max()),
        },
        "traces": traces,
        "qb_audit_rows": len(qb_audit),
        "qb_audit_path": str(QB_AUDIT_PATH),
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, default=clean) + "\n")
    print(f"Wrote {len(traces)} player traces to {REPORT_PATH}")
    print(f"QB audit: {QB_AUDIT_PATH}")
    print("No remote data was read or written.")


if __name__ == "__main__":
    main()
