from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from .config import DIRECT_TARGET, FANTASY_POSITIONS, STAT_TARGETS_BY_POSITION
from .model import load_bundle, load_model, new_regressor
from .v3_1_config import (
    BOOTSTRAP_SAMPLES,
    DEPTH_OPPORTUNITY_PRIORS,
    EFFICIENCY_PRIORS,
    ENSEMBLE_WEIGHTS,
    RANDOM_SEED,
    ROLE_OPPORTUNITY_MAX,
)
from .v3_model import component_ppr, load_v3_bundle, metric_set, predict_v3_targets


OPPORTUNITY_TARGETS = {
    "QB": ("pass_attempts", "rush_attempts"),
    "RB": ("rush_attempts", "targets"),
    "WR": ("targets", "rush_attempts"),
    "TE": ("targets", "rush_attempts"),
}


def history_category(row: pd.Series) -> str:
    games = float(row.get("career_games_before", 0) or 0)
    if games <= 0:
        return "zero_games"
    if games <= 3:
        return "1_3_games"
    if games <= 8:
        return "4_8_games"
    if games <= 16:
        return "9_16_games"
    return "17_plus_games"


def sample_weight(row: pd.Series, position: str) -> float:
    games = max(0.0, float(row.get("career_games_before", 0) or 0))
    opportunity = {
        "QB": row.get("pass_attempts_l8"),
        "RB": row.get("true_touches_l8"),
        "WR": row.get("targets_l8"),
        "TE": row.get("targets_l8"),
    }[position]
    opportunity = 0.0 if pd.isna(opportunity) else max(0.0, float(opportunity))
    game_strength = games / (games + 10.0)
    opportunity_reference = 24.0 if position == "QB" else (10.0 if position == "RB" else 5.0)
    opportunity_strength = opportunity / (opportunity + opportunity_reference)
    return float(np.clip(0.55 * game_strength + 0.45 * opportunity_strength, 0, 1))


def _recent_opportunity(row: pd.Series, position: str) -> float | None:
    names = {
        "QB": ("pass_attempts_l3", "pbp_pass_attempts_l3"),
        "RB": ("true_touches_l3", "pbp_touches_l3"),
        "WR": ("targets_l3", "pbp_targets_l3"),
        "TE": ("targets_l3", "pbp_targets_l3"),
    }[position]
    values = [float(row[name]) for name in names if name in row and pd.notna(row[name])]
    return float(np.mean(values)) if values else None


def role_confidence(row: pd.Series, position: str) -> float:
    """Bounded probability-like opportunity confidence, not a points multiplier."""
    depth = row.get("depth_rank")
    recent = _recent_opportunity(row, position)
    usage_reference = {"QB": 30.0, "RB": 16.0, "WR": 8.0, "TE": 6.0}[position]
    usage_signal = 0.5 if recent is None else float(np.clip(recent / usage_reference, 0, 1))
    if pd.isna(depth):
        nominal = usage_signal
    else:
        rank = max(1, int(depth))
        priors = DEPTH_OPPORTUNITY_PRIORS[position]
        nominal = priors.get(rank, priors[max(priors)] * math.exp(-0.7 * (rank - max(priors))))
    # Strong real usage can override stale nominal depth, while no usage cannot
    # erase a clear starter designation by itself.
    confidence = 0.65 * nominal + 0.35 * usage_signal
    if bool(row.get("is_starter", False)):
        confidence = max(confidence, 0.72)
    if pd.notna(depth) and int(depth) > 1 and recent is not None and recent >= usage_reference * 0.8:
        confidence = max(confidence, 0.68)
    # Draft investment is a low-sample prior only. It cannot create volume and
    # decays quickly once actual NFL opportunity exists.
    if float(row.get("career_games_before", 0) or 0) <= 8:
        draft_round = row.get("draft_round")
        draft_status = str(row.get("draft_status", "")).lower()
        if draft_status == "undrafted":
            draft_prior = 0.22
        elif pd.notna(draft_round):
            draft_prior = {1: 1.0, 2: 0.86, 3: 0.72, 4: 0.58, 5: 0.47, 6: 0.39, 7: 0.33}.get(int(draft_round), 0.28)
        else:
            draft_prior = None
        if draft_prior is not None:
            confidence *= 0.78 + 0.22 * draft_prior
    return float(np.clip(confidence, 0.01, 1.0))


def _depth_opportunity_ceiling(position: str, target: str, row: pd.Series) -> float | None:
    depth = row.get("depth_rank")
    if pd.isna(depth):
        return None
    rank = max(1, int(depth))
    ceilings = ROLE_OPPORTUNITY_MAX.get(position, {})
    selected = ceilings.get(rank, ceilings.get(max(ceilings), {}))
    return selected.get(target)


def arbitrate_opportunity(raw: float, row: pd.Series, position: str, target: str, role_confidence_fn=role_confidence) -> float:
    raw = max(0.0, float(raw))
    weight = sample_weight(row, position)
    confidence = role_confidence_fn(row, position)
    recent_columns = {
        "pass_attempts": ("pass_attempts_l3", "pbp_pass_attempts_l3"),
        "rush_attempts": ("rush_attempts_l3", "pbp_rush_attempts_l3"),
        "targets": ("targets_l3", "pbp_targets_l3"),
    }.get(target, ())
    recent_values = [float(row[name]) for name in recent_columns if name in row and pd.notna(row[name])]
    recent = float(np.mean(recent_values)) if recent_values else None

    if recent is not None:
        stabilized = raw * (0.65 + 0.25 * weight) + recent * (0.35 - 0.25 * weight)
    else:
        # No NFL history: current role provides opportunity, never efficiency.
        position_prior = {
            "QB": {"pass_attempts": 33.0, "rush_attempts": 3.5},
            "RB": {"rush_attempts": 13.0, "targets": 3.5},
            "WR": {"targets": 7.0, "rush_attempts": 0.2},
            "TE": {"targets": 5.5, "rush_attempts": 0.0},
        }[position].get(target, 0.0)
        stabilized = raw * weight + position_prior * confidence * (1 - weight)

    ceiling = _depth_opportunity_ceiling(position, target, row)
    if ceiling is not None:
        # A smooth ceiling constrains opportunity while letting demonstrated
        # recent usage override stale depth-chart ordering.
        demonstrated = recent is not None and recent >= ceiling * 0.8
        effective_ceiling = ceiling * (1.6 if demonstrated else 1.0)
        stabilized = effective_ceiling * math.tanh(stabilized / max(effective_ceiling, 0.1))
    return max(0.0, stabilized)


def _shrunk_rate(raw_rate: float, prior: float, row: pd.Series, position: str, low: float, high: float) -> float:
    weight = sample_weight(row, position)
    bounded_observation = float(np.clip(raw_rate, low, high))
    return float(np.clip(prior * (1 - weight) + bounded_observation * weight, low, high))


def normalize_team_opportunities(
    frame: pd.DataFrame,
    predictions: list[dict[str, float]],
    role_confidence_fn=role_confidence,
    *,
    refill_budget: bool = False,
    refill_week_one_only: bool = False,
    current_qb_depth_gate: bool = False,
    robust_week_one_context: bool = False,
) -> tuple[list[dict[str, float]], pd.DataFrame]:
    """Fit player opportunity into pregame team pass/rush budgets."""
    output = [dict(values) for values in predictions]
    audit: list[dict[str, object]] = []
    indexed = frame.reset_index(drop=True)

    def context_value(sample: pd.Series, stem: str, default: float) -> float:
        if robust_week_one_context and int(sample.get("week", 0) or 0) == 1:
            values = [
                float(sample[name])
                for name in (f"{stem}_l3", f"{stem}_l5", f"{stem}_l8")
                if name in sample and pd.notna(sample[name])
            ]
            if values:
                return float(np.median(values))
        return next((
            float(sample[name])
            for name in (f"{stem}_l3", f"{stem}_season_avg")
            if name in sample and pd.notna(sample[name])
        ), default)

    for (season, week, team), indices in indexed.groupby(["season", "week", "team"], dropna=False).groups.items():
        idx = list(indices)
        sample = indexed.loc[idx[0]]
        plays = context_value(sample, "team_offensive_plays", 64.0)
        pass_rate = context_value(sample, "team_pass_rate", 0.56)
        target_budget = float(np.clip(plays * pass_rate * 0.95, 24, 46))
        rb_carry_budget = float(np.clip(plays * (1 - pass_rate) * 0.86, 14, 34))
        pass_attempt_budget = float(np.clip(plays * pass_rate, 25, 48))

        def scale(target: str, eligible: Iterable[int], budget: float) -> tuple[float, float]:
            eligible = list(eligible)
            before = sum(output[i].get(target, 0.0) for i in eligible)
            if before > budget and before > 0:
                # Reduce uncertain depth before demonstrated starters. Equal
                # scaling made a crowded offseason player pool suppress its
                # established stars along with roster-fringe players.
                weighted = {
                    i: output[i].get(target, 0.0)
                    * (0.15 + 0.85 * role_confidence_fn(indexed.loc[i], str(indexed.loc[i, "historical_position"])) ** 2)
                    for i in eligible
                }
                if current_qb_depth_gate and target == "pass_attempts":
                    has_current_starter = any(
                        bool(indexed.loc[i].get("is_starter", False))
                        or (
                            pd.notna(indexed.loc[i].get("depth_rank"))
                            and int(indexed.loc[i]["depth_rank"]) == 1
                        )
                        for i in eligible
                    )
                    if has_current_starter:
                        for i in eligible:
                            depth = indexed.loc[i].get("depth_rank")
                            is_starter = bool(indexed.loc[i].get("is_starter", False))
                            if is_starter or (pd.notna(depth) and int(depth) == 1):
                                current_role_share = 0.98
                            elif pd.notna(depth):
                                current_role_share = DEPTH_OPPORTUNITY_PRIORS["QB"].get(
                                    int(depth), DEPTH_OPPORTUNITY_PRIORS["QB"][3],
                                )
                            else:
                                current_role_share = 0.03
                            weighted[i] *= current_role_share
                weighted_total = sum(weighted.values())
                # The legacy path deliberately preserves v3.1-v3.3 exactly.
                # v3.3.1 may refill the available team budget after role-aware
                # redistribution instead of silently discarding opportunity.
                should_refill = refill_budget and (not refill_week_one_only or int(week) == 1)
                factor = budget / weighted_total if should_refill and weighted_total > 0 else (
                    min(1.0, budget / weighted_total) if weighted_total > 0 else 0.0
                )
                for i in eligible:
                    output[i][target] = weighted[i] * factor
            return before, sum(output[i].get(target, 0.0) for i in eligible)

        target_before, target_after = scale("targets", idx, target_budget)
        rb_indices = [i for i in idx if indexed.loc[i, "historical_position"] == "RB"]
        carries_before, carries_after = scale("rush_attempts", rb_indices, rb_carry_budget)
        qb_indices = [i for i in idx if indexed.loc[i, "historical_position"] == "QB"]
        passes_before, passes_after = scale("pass_attempts", qb_indices, pass_attempt_budget)
        audit.append({
            "season": season, "week": week, "team": team,
            "target_budget": target_budget, "targets_before": target_before, "targets_after": target_after,
            "rb_carry_budget": rb_carry_budget, "rb_carries_before": carries_before, "rb_carries_after": carries_after,
            "pass_attempt_budget": pass_attempt_budget, "pass_attempts_before": passes_before, "pass_attempts_after": passes_after,
        })
    return output, pd.DataFrame(audit)


def _pregame_ratio(
    row: pd.Series,
    numerator: str,
    denominator: str,
    prior: float,
    *,
    robust_week_one_context: bool = False,
) -> float:
    suffixes = ("l3", "l5", "l8") if robust_week_one_context and int(row.get("week", 0) or 0) == 1 else ("l3", "season_avg")
    observed_values: list[float] = []
    for suffix in suffixes:
        top, bottom = row.get(f"{numerator}_{suffix}"), row.get(f"{denominator}_{suffix}")
        if pd.notna(top) and pd.notna(bottom) and float(bottom) > 0:
            observed_values.append(float(top) / float(bottom))
    if observed_values:
        observed = float(np.median(observed_values))
        weight = sample_weight(row, str(row["historical_position"]))
        return float(np.clip(prior * (1 - weight) + np.clip(observed, 0, 1) * weight, 0, 1))
    return prior


def derive_and_normalize_red_zone(
    frame: pd.DataFrame,
    predictions: list[dict[str, float]],
    audit: pd.DataFrame,
    role_confidence_fn=role_confidence,
    *,
    refill_budget: bool = False,
    refill_week_one_only: bool = False,
    current_qb_depth_gate: bool = False,
    robust_week_one_context: bool = False,
) -> tuple[list[dict[str, float]], pd.DataFrame]:
    output = [dict(values) for values in predictions]
    indexed = frame.reset_index(drop=True)

    def context_value(sample: pd.Series, stem: str, default: float) -> float:
        if robust_week_one_context and int(sample.get("week", 0) or 0) == 1:
            values = [
                float(sample[name])
                for name in (f"{stem}_l3", f"{stem}_l5", f"{stem}_l8")
                if name in sample and pd.notna(sample[name])
            ]
            if values:
                return float(np.median(values))
        return next((
            float(sample[name])
            for name in (f"{stem}_l3", f"{stem}_season_avg")
            if name in sample and pd.notna(sample[name])
        ), default)
    for index, row in indexed.iterrows():
        position = str(row["historical_position"])
        rushes = output[index].get("rush_attempts", 0.0)
        targets = output[index].get("targets", 0.0)
        passes = output[index].get("pass_attempts", 0.0)
        rush_prior = 0.16 if position == "RB" else 0.07
        target_prior = {"RB": 0.10, "WR": 0.13, "TE": 0.16}.get(position, 0.0)
        ratio_options = {"robust_week_one_context": robust_week_one_context}
        output[index]["red_zone_carries"] = rushes * _pregame_ratio(row, "red_zone_carries", "pbp_rush_attempts", rush_prior, **ratio_options)
        output[index]["inside_10_carries"] = rushes * _pregame_ratio(row, "inside_10_carries", "pbp_rush_attempts", rush_prior * 0.55, **ratio_options)
        output[index]["inside_5_carries"] = rushes * _pregame_ratio(row, "inside_5_carries", "pbp_rush_attempts", rush_prior * 0.28, **ratio_options)
        output[index]["red_zone_targets"] = targets * _pregame_ratio(row, "red_zone_targets", "pbp_targets", target_prior, **ratio_options)
        output[index]["inside_10_targets"] = targets * _pregame_ratio(row, "inside_10_targets", "pbp_targets", target_prior * 0.45, **ratio_options)
        output[index]["red_zone_pass_attempts"] = passes * _pregame_ratio(row, "red_zone_pass_attempts", "pbp_pass_attempts", 0.12 if position == "QB" else 0.0, **ratio_options)

    red_audit: list[dict[str, object]] = []
    for (season, week, team), indices in indexed.groupby(["season", "week", "team"], dropna=False).groups.items():
        idx = list(indices)
        sample = indexed.loc[idx[0]]
        red_plays = context_value(sample, "team_red_zone_plays", 8.0)
        goal_plays = context_value(sample, "team_goal_to_go_plays", 3.0)
        pass_rate = context_value(sample, "team_pass_rate", 0.56)
        budgets = {
            "red_zone_carries": max(1.0, red_plays * (1 - pass_rate)),
            "red_zone_targets": max(1.0, red_plays * pass_rate * 0.9),
            "red_zone_pass_attempts": max(1.0, red_plays * pass_rate),
            "inside_10_carries": max(0.5, goal_plays * (1 - pass_rate)),
            "inside_10_targets": max(0.5, goal_plays * pass_rate * 0.9),
            "inside_5_carries": max(0.35, goal_plays * (1 - pass_rate) * 0.55),
        }
        row_audit: dict[str, object] = {"season": season, "week": week, "team": team}
        for target, budget in budgets.items():
            eligible = [i for i in idx if output[i].get(target, 0.0) > 0]
            before = sum(output[i].get(target, 0.0) for i in eligible)
            if before > budget and before > 0:
                weighted = {
                    i: output[i][target] * (0.15 + 0.85 * role_confidence_fn(indexed.loc[i], str(indexed.loc[i, "historical_position"])) ** 2)
                    for i in eligible
                }
                if current_qb_depth_gate and target == "red_zone_pass_attempts":
                    has_current_starter = any(
                        bool(indexed.loc[i].get("is_starter", False))
                        or (
                            pd.notna(indexed.loc[i].get("depth_rank"))
                            and int(indexed.loc[i]["depth_rank"]) == 1
                        )
                        for i in eligible
                    )
                    if has_current_starter:
                        for i in eligible:
                            depth = indexed.loc[i].get("depth_rank")
                            is_starter = bool(indexed.loc[i].get("is_starter", False))
                            weighted[i] *= 0.98 if is_starter or (
                                pd.notna(depth) and int(depth) == 1
                            ) else DEPTH_OPPORTUNITY_PRIORS["QB"].get(
                                int(depth) if pd.notna(depth) else 3,
                                DEPTH_OPPORTUNITY_PRIORS["QB"][3],
                            )
                total = sum(weighted.values())
                should_refill = refill_budget and (not refill_week_one_only or int(week) == 1)
                factor = budget / total if should_refill and total > 0 else (
                    min(1.0, budget / total) if total > 0 else 0.0
                )
                for i in eligible:
                    output[i][target] = weighted[i] * factor
            row_audit[f"{target}_budget"] = budget
            row_audit[f"{target}_before"] = before
            row_audit[f"{target}_after"] = sum(output[i].get(target, 0.0) for i in eligible)
        red_audit.append(row_audit)
    red_frame = pd.DataFrame(red_audit)
    return output, audit.merge(red_frame, on=["season", "week", "team"], how="left", validate="one_to_one")


def coherent_components(
    frame: pd.DataFrame,
    raw_predictions: list[dict[str, float]],
    role_confidence_fn=role_confidence,
    *,
    refill_budget: bool = False,
    refill_week_one_only: bool = False,
    current_qb_depth_gate: bool = False,
    robust_week_one_context: bool = False,
    passing_hierarchy_fn=None,
) -> tuple[list[dict[str, float]], pd.DataFrame]:
    arbitrated: list[dict[str, float]] = []
    for (_, row), raw in zip(frame.reset_index(drop=True).iterrows(), raw_predictions, strict=True):
        position = str(row["historical_position"])
        values = {name: max(0.0, float(value)) for name, value in raw.items() if name != DIRECT_TARGET}
        for target in OPPORTUNITY_TARGETS[position]:
            if target in values:
                values[target] = arbitrate_opportunity(values[target], row, position, target, role_confidence_fn)
        arbitrated.append(values)
    arbitrated, audit = normalize_team_opportunities(
        frame,
        arbitrated,
        role_confidence_fn,
        refill_budget=refill_budget,
        refill_week_one_only=refill_week_one_only,
        current_qb_depth_gate=current_qb_depth_gate,
        robust_week_one_context=robust_week_one_context,
    )
    if passing_hierarchy_fn is not None:
        arbitrated, audit = passing_hierarchy_fn(
            frame.reset_index(drop=True), arbitrated, audit, role_confidence_fn,
        )
    arbitrated, audit = derive_and_normalize_red_zone(
        frame,
        arbitrated,
        audit,
        role_confidence_fn,
        refill_budget=refill_budget,
        refill_week_one_only=refill_week_one_only,
        current_qb_depth_gate=current_qb_depth_gate,
        robust_week_one_context=robust_week_one_context,
    )

    coherent: list[dict[str, float]] = []
    for (_, row), values, raw in zip(frame.reset_index(drop=True).iterrows(), arbitrated, raw_predictions, strict=True):
        position = str(row["historical_position"])
        priors = EFFICIENCY_PRIORS[position]
        result = dict(values)
        if position == "QB":
            attempts = result.get("pass_attempts", 0.0)
            raw_attempts = max(raw.get("pass_attempts", 0.0), 0.25)
            completion = _shrunk_rate(raw.get("completions", 0.0) / raw_attempts, priors["completion_rate"], row, position, 0.45, 0.78)
            ypa = _shrunk_rate(raw.get("passing_yards", 0.0) / raw_attempts, priors["passing_yards_per_attempt"], row, position, 4.5, 10.5)
            red_attempts = result.get("red_zone_pass_attempts", 0.0)
            td_rate = _shrunk_rate(raw.get("passing_touchdowns", 0.0) / max(red_attempts, 0.25), 0.22, row, position, 0.05, 0.55)
            int_rate = _shrunk_rate(raw.get("interceptions_thrown", 0.0) / raw_attempts, priors["interception_rate"], row, position, 0.005, 0.06)
            result.update(completions=attempts * completion, passing_yards=attempts * ypa,
                          passing_touchdowns=red_attempts * td_rate, interceptions_thrown=attempts * int_rate)
            if "passing_first_downs" in result:
                result["passing_first_downs"] = min(result["passing_first_downs"], result["completions"])
        else:
            targets = result.get("targets", 0.0)
            raw_targets = max(raw.get("targets", 0.0), 0.25)
            catch_rate = _shrunk_rate(raw.get("receptions", 0.0) / raw_targets, priors["catch_rate"], row, position, 0.40, 0.90)
            ypt = _shrunk_rate(raw.get("receiving_yards", 0.0) / raw_targets, priors["receiving_yards_per_target"], row, position, 3.0, 13.0)
            red_targets = result.get("red_zone_targets", 0.0)
            rec_td_rate = _shrunk_rate(raw.get("receiving_touchdowns", 0.0) / max(red_targets, 0.25), 0.24 if position == "WR" else (0.27 if position == "TE" else 0.20), row, position, 0.03, 0.60)
            result.update(receptions=targets * catch_rate, receiving_yards=targets * ypt,
                          receiving_touchdowns=red_targets * rec_td_rate)
            if "receiving_first_downs" in result:
                result["receiving_first_downs"] = min(result["receiving_first_downs"], result["receptions"])
        rush_attempts = result.get("rush_attempts", 0.0)
        if "rushing_yards" in result:
            raw_rushes = max(raw.get("rush_attempts", 0.0), 0.25)
            ypc = _shrunk_rate(raw.get("rushing_yards", 0.0) / raw_rushes, priors["rushing_yards_per_attempt"], row, position, 1.5, 8.0)
            red_carries = result.get("red_zone_carries", 0.0)
            td_rate = _shrunk_rate(raw.get("rushing_touchdowns", 0.0) / max(red_carries, 0.25), 0.22, row, position, 0.03, 0.60)
            result["rushing_yards"] = rush_attempts * ypc
            result["rushing_touchdowns"] = red_carries * td_rate
        if "rushing_first_downs" in result:
            result["rushing_first_downs"] = min(result["rushing_first_downs"], rush_attempts)
        coherent.append(result)
    return coherent, audit


def prediction_dicts(models: dict[str, object], frame: pd.DataFrame, features: list[str]) -> list[dict[str, float]]:
    arrays = predict_v3_targets(models, frame, features)
    return [{target: float(values[index]) for target, values in arrays.items()} for index in range(len(frame))]


def opportunity_feature_subset(features: list[str]) -> list[str]:
    keep = (
        "season", "week", "games_", "career_", "prior_", "has_prior", "is_home", "neutral_site",
        "days_rest", "short_week", "long_rest", "returning_from_bye", "is_thursday",
        "attempt", "target", "touch", "reception", "share", "dropback", "red_zone", "inside_",
        "goal_line", "team_", "two_minute", "third_down", "early_down",
        "yards_per_", "completion_percentage", "td_rate", "interception_rate",
    )
    return [feature for feature in features if feature.startswith(keep) or any(token in feature for token in keep)]


def select_ensemble_weight(actual: np.ndarray, v2: np.ndarray, candidate: np.ndarray) -> float:
    return min(ENSEMBLE_WEIGHTS, key=lambda weight: float(np.mean(np.abs(actual - (v2 * (1 - weight) + candidate * weight)))))


def bootstrap_mae_difference(actual: np.ndarray, baseline: np.ndarray, candidate: np.ndarray) -> dict[str, float]:
    rng = np.random.default_rng(RANDOM_SEED)
    differences = []
    for _ in range(BOOTSTRAP_SAMPLES):
        index = rng.integers(0, len(actual), len(actual))
        differences.append(float(np.mean(np.abs(candidate[index] - actual[index])) - np.mean(np.abs(baseline[index] - actual[index]))))
    low, high = np.quantile(differences, [0.025, 0.975])
    return {"mean": round(float(np.mean(differences)), 4), "lower_95": round(float(low), 4), "upper_95": round(float(high), 4)}


def add_error_slices(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    games = output["career_games_before"].fillna(0)
    output["history_bucket"] = pd.cut(games, [-1, 0, 3, 8, 16, np.inf], labels=["zero_games", "1_3_games", "4_8_games", "9_16_games", "17_plus_games"])
    output["experience_bucket"] = np.select([games.eq(0), games.le(16), games.le(34)], ["rookie", "young", "developing"], default="veteran")
    output["opportunity_bucket"] = pd.qcut(output["prior_season_true_touches_pg"].fillna(output["prior_season_targets_pg"]).fillna(0).rank(method="first"), 4, labels=["low", "medium", "high", "elite"])
    output["starter_proxy"] = output["prior_season_position_rank_pct"].fillna(0).ge(0.55)
    output["established_elite"] = output["prior_season_games"].fillna(0).ge(10) & output["prior_season_position_rank_pct"].fillna(0).ge(0.8)
    rush_rate = output["rushing_touchdowns_season_avg"].div(output["rush_attempts_season_avg"].replace(0, np.nan))
    output["extreme_td_prior"] = output["passing_td_rate_season"].gt(0.08) | output["receiving_td_rate_season"].gt(0.15) | rush_rate.gt(0.12)
    recent = np.select([
        output["historical_position"].eq("QB"), output["historical_position"].eq("RB")
    ], [output["pbp_pass_attempts_l3"], output["pbp_touches_l3"]], default=output["pbp_targets_l3"])
    season = np.select([
        output["historical_position"].eq("QB"), output["historical_position"].eq("RB")
    ], [output["pbp_pass_attempts_season_avg"], output["pbp_touches_season_avg"]], default=output["pbp_targets_season_avg"])
    output["role_increase"] = np.isfinite(recent) & np.isfinite(season) & (recent >= season * 1.35)
    output["role_decrease"] = np.isfinite(recent) & np.isfinite(season) & (recent <= season * 0.65)
    return output


def error_analysis(frame: pd.DataFrame, prediction_columns: list[str]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    dimensions = ["historical_position", "history_bucket", "experience_bucket", "opportunity_bucket", "starter_proxy", "role_increase", "role_decrease", "established_elite", "extreme_td_prior"]
    actual = frame[DIRECT_TARGET]
    for dimension in dimensions:
        for value, subset in frame.groupby(dimension, observed=True, dropna=False):
            for model in prediction_columns:
                error = subset[model] - subset[DIRECT_TARGET]
                rows.append({"dimension": dimension, "bucket": str(value), "model": model, "rows": len(subset), "mae": float(error.abs().mean()), "bias": float(error.mean())})
    return pd.DataFrame(rows)


@dataclass
class CandidateOutput:
    predictions: np.ndarray
    components: list[dict[str, float]]
    direct: np.ndarray
    audit: pd.DataFrame


def predict_coherent_candidate(
    frame: pd.DataFrame,
    models_by_position: dict[str, dict[str, object]],
    features_by_position: dict[str, list[str]],
    direct_weight_by_position: dict[str, float] | None = None,
    role_confidence_fn=role_confidence,
    *,
    refill_budget: bool = False,
    refill_week_one_only: bool = False,
    current_qb_depth_gate: bool = False,
    robust_week_one_context: bool = False,
    passing_hierarchy_fn=None,
) -> CandidateOutput:
    indexed = frame.reset_index(drop=True)
    raw_rows: list[dict[str, float] | None] = [None] * len(indexed)
    for position, indices in indexed.groupby("historical_position", sort=False).groups.items():
        idx = list(indices)
        rows = indexed.loc[idx].reset_index(drop=True)
        raw = prediction_dicts(models_by_position[position], rows, features_by_position[position])
        for original, values in zip(idx, raw, strict=True):
            raw_rows[original] = values

    complete_raw = [item or {} for item in raw_rows]
    # This must run across every position at once. Otherwise RB, WR and TE each
    # receive a full team target budget and the constraint is meaningless.
    coherent, audit = coherent_components(
        indexed,
        complete_raw,
        role_confidence_fn,
        refill_budget=refill_budget,
        refill_week_one_only=refill_week_one_only,
        current_qb_depth_gate=current_qb_depth_gate,
        robust_week_one_context=robust_week_one_context,
        passing_hierarchy_fn=passing_hierarchy_fn,
    )
    components = component_ppr(
        {name: np.array([item.get(name, 0.0) for item in coherent]) for name in set().union(*(item.keys() for item in coherent))},
        len(indexed),
    )
    direct = np.array([item.get(DIRECT_TARGET, 0.0) for item in complete_raw])
    output = np.zeros(len(indexed))
    for position, indices in indexed.groupby("historical_position", sort=False).groups.items():
        idx = list(indices)
        weight = 0.0 if direct_weight_by_position is None else direct_weight_by_position.get(position, 0.0)
        sparse_scale = np.array([sample_weight(indexed.loc[i], position) for i in idx])
        effective_weight = weight * (0.25 + 0.75 * sparse_scale)
        output[idx] = components[idx] * (1 - effective_weight) + direct[idx] * effective_weight
    return CandidateOutput(np.maximum(0, output), coherent, direct, audit)


def load_position_models(artifact_dir: Path, manifest: dict) -> dict[str, dict[str, object]]:
    return {
        position: {target: load_model(artifact_dir / filename) for target, filename in details["models"].items()}
        for position, details in manifest["positions"].items()
    }


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")
