from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .v3_3_2_model import PassingHierarchyConfig, allocate_team_passing_hierarchy


@dataclass(frozen=True)
class LearnedShareConfig:
    learned_weight: float = 0.5
    role_threshold: float | None = None
    qb_environment_refill: float = 0.0
    use_learned_team_volume: bool = False
    team_volume_weight: float = 1.0


def allocate_learned_shares(frame, predictions, audit, role_confidence_fn, *, config=LearnedShareConfig()):
    """Redistribute assigned volume with learned shares; never refill budgets."""
    adjusted_audit = audit.copy()
    if config.use_learned_team_volume:
        budgets = frame.groupby(["season", "week", "team"], dropna=False).first()
        for index, row in adjusted_audit.iterrows():
            key = (row.season, row.week, row.team)
            if key not in budgets.index:
                continue
            source = budgets.loc[key]
            adjusted_audit.loc[index, "pass_attempt_budget"] = max(1.0, (
                float(row.pass_attempt_budget) * (1 - config.team_volume_weight)
                + float(source.get("_team_pass_budget", row.pass_attempt_budget)) * config.team_volume_weight
            ))
            adjusted_audit.loc[index, "rb_carry_budget"] = max(1.0, (
                float(row.rb_carry_budget) * (1 - config.team_volume_weight)
                + float(source.get("_team_rush_budget", row.rb_carry_budget / .86)) * .86 * config.team_volume_weight
            ))
    output, hierarchy = allocate_team_passing_hierarchy(
        frame, predictions, adjusted_audit, role_confidence_fn,
        config=PassingHierarchyConfig(
            qb_budget_refill=config.team_volume_weight if config.use_learned_team_volume else config.qb_environment_refill,
            refill_modeled_targets=False,
        ),
    )
    indexed = frame.reset_index(drop=True)
    rows = []
    for key, grouped in indexed.groupby(["season", "week", "team"], dropna=False).groups.items():
        indices = list(grouped)
        changes = {}
        for target, positions, prediction_column in (
            ("targets", {"RB", "WR", "TE"}, "_learned_target_share"),
            ("rush_attempts", {"RB"}, "_learned_rush_share"),
        ):
            eligible = [i for i in indices if indexed.loc[i, "historical_position"] in positions]
            assigned = sum(output[i].get(target, 0.0) for i in eligible)
            if config.use_learned_team_volume and target == "targets" and eligible:
                learned_budget = float(indexed.loc[eligible[0]].get("_team_target_budget", assigned / .991322)) * .991322
                assigned = max(0.0, assigned * (1 - config.team_volume_weight) + learned_budget * config.team_volume_weight)
            elif config.use_learned_team_volume and target == "rush_attempts" and eligible:
                learned_budget = float(indexed.loc[eligible[0]].get("_team_rush_budget", assigned / .86)) * .86
                assigned = max(0.0, assigned * (1 - config.team_volume_weight) + learned_budget * config.team_volume_weight)
            base = np.array([max(0.0, output[i].get(target, 0.0)) for i in eligible], dtype=float)
            learned = np.array([max(0.0, float(indexed.loc[i].get(prediction_column, 0) or 0)) for i in eligible], dtype=float)
            if assigned > 0 and base.sum() > 0 and learned.sum() > 0:
                base /= base.sum()
                learned /= learned.sum()
                weights = []
                for offset, i in enumerate(eligible):
                    weight = config.learned_weight
                    if config.role_threshold is not None:
                        probability = max(
                            float(indexed.loc[i].get("_prob_rising", 0) or 0),
                            float(indexed.loc[i].get("_prob_falling", 0) or 0),
                        )
                        weight = config.learned_weight if probability >= config.role_threshold else 0.0
                    weights.append(base[offset] * (1 - weight) + learned[offset] * weight)
                total = sum(weights)
                for i, weight in zip(eligible, weights, strict=True):
                    output[i][target] = assigned * weight / total
            changes[f"learned_{target}_before"] = assigned
            changes[f"learned_{target}_after"] = sum(output[i].get(target, 0.0) for i in eligible)
        rows.append({"season": key[0], "week": key[1], "team": key[2], **changes})
    return output, hierarchy.merge(pd.DataFrame(rows), on=["season", "week", "team"], how="left", validate="one_to_one")


def learned_share_allocator(config: LearnedShareConfig):
    return lambda frame, predictions, audit, role_confidence_fn: allocate_learned_shares(
        frame, predictions, audit, role_confidence_fn, config=config,
    )
