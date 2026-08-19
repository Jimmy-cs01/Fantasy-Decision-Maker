from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .v3_3_2_model import PassingHierarchyConfig, allocate_team_passing_hierarchy


@dataclass(frozen=True)
class RoleShareConfig:
    """Leakage-safe opportunity-share experiment layered over v3.3.2."""

    stable_recent_share_weight: float = 0.25
    changing_recent_share_weight: float = 0.55
    qb_environment_refill: float = 0.0
    refill_targets: bool = True
    refill_rb_carries: bool = True
    qb_rush_archetype_weight: float = 0.0


def _median(row: pd.Series, names: tuple[str, ...]) -> float | None:
    values = [float(row[name]) for name in names if name in row and pd.notna(row[name])]
    return float(np.median(values)) if values else None


def role_change_strength(row: pd.Series, position: str) -> float:
    """Return a pregame-only structural role-change signal in [0, 1]."""
    if position == "RB":
        recent = _median(row, ("team_rush_share_l3", "backfield_rush_share_l3"))
        baseline = _median(row, ("team_rush_share_l8", "team_rush_share_season_avg"))
    elif position in {"WR", "TE"}:
        recent = _median(row, ("pbp_target_share_l3", "target_share_l3"))
        baseline = _median(row, ("pbp_target_share_l8", "target_share_season_avg"))
    else:
        recent = _median(row, ("pbp_rush_attempts_l3", "rush_attempts_l3"))
        baseline = _median(row, ("pbp_rush_attempts_l8", "rush_attempts_season_avg"))
    usage_delta = abs(recent - baseline) if recent is not None and baseline is not None else 0.0
    usage_scale = 0.12 if position in {"RB", "WR", "TE"} else 3.0
    snap_delta = abs(float(row.get("snap_pct_delta_1", 0) or 0)) if pd.notna(row.get("snap_pct_delta_1")) else 0.0
    return float(np.clip(max(usage_delta / usage_scale, snap_delta / 0.20), 0, 1))


def _recent_share(row: pd.Series, target: str) -> float | None:
    if target == "rush_attempts":
        return _median(row, (
            "team_rush_share_l3", "team_rush_share_l5", "team_rush_share_l8",
            "backfield_rush_share_l3", "backfield_rush_share_l5",
        ))
    return _median(row, (
        "pbp_target_share_l3", "pbp_target_share_l5", "pbp_target_share_l8",
        "target_share_l3", "target_share_l5",
    ))


def _allocate_room(
    indexed: pd.DataFrame,
    output: list[dict[str, float]],
    indices: list[int],
    target: str,
    budget: float,
    role_confidence_fn,
    config: RoleShareConfig,
) -> tuple[float, float, float]:
    before = sum(output[i].get(target, 0.0) for i in indices)
    if not indices or budget <= 0:
        return before, before, 0.0
    predicted = np.array([max(0.0, output[i].get(target, 0.0)) for i in indices], dtype=float)
    if predicted.sum() <= 0:
        return before, before, budget
    predicted /= predicted.sum()
    observed = np.array([
        max(0.0, _recent_share(indexed.loc[i], target) or 0.0) for i in indices
    ], dtype=float)
    available = observed > 0
    if observed.sum() > 0:
        observed /= observed.sum()
    else:
        observed = predicted.copy()
    weights = []
    for offset, i in enumerate(indices):
        position = str(indexed.loc[i, "historical_position"])
        change = role_change_strength(indexed.loc[i], position)
        recent_weight = (
            config.stable_recent_share_weight
            + change * (config.changing_recent_share_weight - config.stable_recent_share_weight)
        ) if available[offset] else 0.0
        blended = predicted[offset] * (1 - recent_weight) + observed[offset] * recent_weight
        confidence = float(role_confidence_fn(indexed.loc[i], position))
        weights.append(blended * (0.35 + 0.65 * confidence))
    total = sum(weights)
    if total <= 0:
        return before, before, budget
    for i, weight in zip(indices, weights, strict=True):
        output[i][target] = budget * weight / total
    after = sum(output[i].get(target, 0.0) for i in indices)
    return before, after, max(0.0, budget - after)


def allocate_role_shares(
    frame: pd.DataFrame,
    predictions: list[dict[str, float]],
    audit: pd.DataFrame,
    role_confidence_fn,
    *,
    config: RoleShareConfig = RoleShareConfig(),
) -> tuple[list[dict[str, float]], pd.DataFrame]:
    """Allocate team budgets with shifted player shares, retaining an explicit residual."""
    passing = PassingHierarchyConfig(
        qb_budget_refill=config.qb_environment_refill,
        refill_modeled_targets=False,
    )
    output, hierarchy = allocate_team_passing_hierarchy(
        frame, predictions, audit, role_confidence_fn, config=passing,
    )
    indexed = frame.reset_index(drop=True)
    by_team = hierarchy.set_index(["season", "week", "team"], drop=False)
    rows: list[dict[str, object]] = []
    for key, grouped in indexed.groupby(["season", "week", "team"], dropna=False).groups.items():
        indices = list(grouped)
        team_row = by_team.loc[key]
        if isinstance(team_row, pd.DataFrame):
            team_row = team_row.iloc[0]
        receivers = [i for i in indices if indexed.loc[i, "historical_position"] in {"RB", "WR", "TE"}]
        backs = [i for i in indices if indexed.loc[i, "historical_position"] == "RB"]
        target_budget = float(team_row["hierarchy_modeled_target_budget"])
        carry_budget = float(team_row["rb_carry_budget"])
        if config.refill_targets:
            target_before, target_after, other_targets = _allocate_room(
                indexed, output, receivers, "targets", target_budget, role_confidence_fn, config,
            )
        else:
            target_before = target_after = sum(output[i].get("targets", 0.0) for i in receivers)
            other_targets = max(0.0, target_budget - target_after)
        if config.refill_rb_carries:
            carries_before, carries_after, other_carries = _allocate_room(
                indexed, output, backs, "rush_attempts", carry_budget, role_confidence_fn, config,
            )
        else:
            carries_before = carries_after = sum(output[i].get("rush_attempts", 0.0) for i in backs)
            other_carries = max(0.0, carry_budget - carries_after)

        if config.qb_rush_archetype_weight > 0:
            for i in indices:
                if indexed.loc[i, "historical_position"] != "QB":
                    continue
                prior = _median(indexed.loc[i], (
                    "rush_attempts_l3", "rush_attempts_l5", "rush_attempts_l8",
                    "prior_season_rush_attempts_pg",
                ))
                if prior is not None and prior >= 4.5:
                    current = output[i].get("rush_attempts", 0.0)
                    output[i]["rush_attempts"] = (
                        current * (1 - config.qb_rush_archetype_weight)
                        + prior * config.qb_rush_archetype_weight
                    )
        rows.append({
            "season": key[0], "week": key[1], "team": key[2],
            "role_share_targets_before": target_before,
            "role_share_targets_after": target_after,
            "role_share_other_targets": other_targets,
            "role_share_carries_before": carries_before,
            "role_share_carries_after": carries_after,
            "role_share_other_carries": other_carries,
        })
    additions = pd.DataFrame(rows)
    return output, hierarchy.merge(additions, on=["season", "week", "team"], how="left", validate="one_to_one")


def role_share_allocator(config: RoleShareConfig):
    return lambda frame, predictions, audit, role_confidence_fn: allocate_role_shares(
        frame, predictions, audit, role_confidence_fn, config=config,
    )
