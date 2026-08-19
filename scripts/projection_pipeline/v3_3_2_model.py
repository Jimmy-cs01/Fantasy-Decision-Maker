from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .v3_3_2_config import MODELED_TARGET_COVERAGE, TARGETS_PER_PASS_ATTEMPT


@dataclass(frozen=True)
class PassingHierarchyConfig:
    qb_budget_refill: float = 0.5
    targets_per_attempt: float = TARGETS_PER_PASS_ATTEMPT
    modeled_target_coverage: float = MODELED_TARGET_COVERAGE
    starter_attempt_share: float = 0.96
    refill_modeled_targets: bool = False


def _role_weight(row: pd.Series, role_confidence_fn) -> float:
    confidence = role_confidence_fn(row, str(row["historical_position"]))
    return 0.15 + 0.85 * confidence**2


def _is_true(value: object) -> bool:
    if pd.isna(value):
        return False
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "t", "yes", "y"}
    return bool(value)


def direct_safety_eligible_mask(frame: pd.DataFrame) -> np.ndarray:
    """Prevent the direct model from bypassing explicit current backup roles."""
    if "depth_rank" not in frame and "is_starter" not in frame:
        return np.ones(len(frame), dtype=bool)
    depth = pd.to_numeric(frame.get("depth_rank", pd.Series(np.nan, index=frame.index)), errors="coerce")
    starter = frame.get("is_starter", pd.Series(np.nan, index=frame.index))
    explicitly_backup = starter.map(lambda value: pd.notna(value) and not _is_true(value))
    buried = depth.ge(2)
    return ~(explicitly_backup | buried).to_numpy()


def allocate_team_passing_hierarchy(
    frame: pd.DataFrame,
    predictions: list[dict[str, float]],
    audit: pd.DataFrame,
    role_confidence_fn,
    *,
    config: PassingHierarchyConfig = PassingHierarchyConfig(),
) -> tuple[list[dict[str, float]], pd.DataFrame]:
    """Reconcile QB attempts first, then allocate an empirical team target budget."""
    output = [dict(values) for values in predictions]
    indexed = frame.reset_index(drop=True)
    audit_by_team = audit.set_index(["season", "week", "team"], drop=False)
    hierarchy_rows: list[dict[str, object]] = []

    for key, indices in indexed.groupby(["season", "week", "team"], dropna=False).groups.items():
        season, week, team = key
        idx = list(indices)
        qb_indices = [i for i in idx if indexed.loc[i, "historical_position"] == "QB"]
        receiver_indices = [i for i in idx if indexed.loc[i, "historical_position"] in {"RB", "WR", "TE"}]
        base_audit = audit_by_team.loc[key]
        if isinstance(base_audit, pd.DataFrame):
            base_audit = base_audit.iloc[0]
        environment_attempts = float(base_audit["pass_attempt_budget"])
        attempts_before = sum(output[i].get("pass_attempts", 0.0) for i in qb_indices)
        attempts_target = attempts_before + config.qb_budget_refill * max(0.0, environment_attempts - attempts_before)
        attempts_target = min(environment_attempts, attempts_target)

        current_starters = [
            i for i in qb_indices
            if _is_true(indexed.loc[i].get("is_starter", False))
            or (pd.notna(indexed.loc[i].get("depth_rank")) and int(indexed.loc[i]["depth_rank"]) == 1)
        ]
        if qb_indices and attempts_target > 0:
            if current_starters:
                starter_weights = {
                    i: max(0.01, output[i].get("pass_attempts", 0.0)) * _role_weight(indexed.loc[i], role_confidence_fn)
                    for i in current_starters
                }
                backups = [i for i in qb_indices if i not in current_starters]
                backup_weights = {
                    i: max(0.01, output[i].get("pass_attempts", 0.0)) * _role_weight(indexed.loc[i], role_confidence_fn)
                    for i in backups
                }
                starter_budget = attempts_target if not backups else attempts_target * config.starter_attempt_share
                backup_budget = attempts_target - starter_budget
                starter_total = sum(starter_weights.values())
                backup_total = sum(backup_weights.values())
                for i in current_starters:
                    output[i]["pass_attempts"] = starter_budget * starter_weights[i] / starter_total
                for i in backups:
                    output[i]["pass_attempts"] = backup_budget * backup_weights[i] / backup_total if backup_total else 0.0
            else:
                weights = {
                    i: max(0.01, output[i].get("pass_attempts", 0.0)) * _role_weight(indexed.loc[i], role_confidence_fn)
                    for i in qb_indices
                }
                total = sum(weights.values())
                for i in qb_indices:
                    output[i]["pass_attempts"] = attempts_target * weights[i] / total if total else 0.0

        attempts_after = sum(output[i].get("pass_attempts", 0.0) for i in qb_indices)
        true_target_budget = attempts_after * config.targets_per_attempt
        modeled_target_budget = true_target_budget * config.modeled_target_coverage
        targets_before = sum(output[i].get("targets", 0.0) for i in receiver_indices)
        target_weights = {
            i: max(0.0, output[i].get("targets", 0.0)) * _role_weight(indexed.loc[i], role_confidence_fn)
            for i in receiver_indices
        }
        target_weight_total = sum(target_weights.values())
        should_reallocate_targets = (
            bool(qb_indices)
            and target_weight_total > 0
            and (config.refill_modeled_targets or targets_before > modeled_target_budget)
        )
        if should_reallocate_targets:
            for i in receiver_indices:
                output[i]["targets"] = modeled_target_budget * target_weights[i] / target_weight_total
        targets_after = sum(output[i].get("targets", 0.0) for i in receiver_indices)

        hierarchy_rows.append({
            "season": season,
            "week": week,
            "team": team,
            "hierarchy_environment_pass_attempts": environment_attempts,
            "hierarchy_qb_attempts_before": attempts_before,
            "hierarchy_qb_attempts_after": attempts_after,
            "hierarchy_true_target_budget": true_target_budget,
            "hierarchy_modeled_target_budget": modeled_target_budget,
            "hierarchy_targets_before": targets_before,
            "hierarchy_targets_after": targets_after,
            "hierarchy_other_targets": max(0.0, true_target_budget - targets_after),
            "hierarchy_target_attempt_ratio": targets_after / attempts_after if attempts_after > 0 else np.nan,
            "hierarchy_target_share_residual": modeled_target_budget - targets_after,
            "hierarchy_qb_rows": len(qb_indices),
            "hierarchy_current_starter_rows": len(current_starters),
            "hierarchy_missing_qb": len(qb_indices) == 0,
        })
    hierarchy = pd.DataFrame(hierarchy_rows)
    return output, audit.merge(
        hierarchy, on=["season", "week", "team"], how="left", validate="one_to_one",
    )


def passing_allocator(config: PassingHierarchyConfig):
    return lambda frame, predictions, audit, role_confidence_fn: allocate_team_passing_hierarchy(
        frame, predictions, audit, role_confidence_fn, config=config,
    )


def passing_coherence_metrics(audit: pd.DataFrame, tolerance: float = 0.05) -> dict[str, float | int]:
    valid = audit.loc[~audit.hierarchy_missing_qb.fillna(True)].copy()
    target_error = valid["hierarchy_targets_after"] - valid["hierarchy_modeled_target_budget"]
    overall_error = target_error.abs()
    overallocated = target_error.clip(lower=0)
    underallocated = (-target_error).clip(lower=0)
    ratio_limit = TARGETS_PER_PASS_ATTEMPT + tolerance
    return {
        "teams": int(len(audit)),
        "material_target_overallocation": int(
            valid.hierarchy_target_attempt_ratio.gt(ratio_limit).sum()
        ),
        "missing_qb_teams": int(audit.hierarchy_missing_qb.fillna(False).sum()),
        "material_target_underallocation": int(
            underallocated.gt(np.maximum(2.0, valid.hierarchy_modeled_target_budget * 0.15)).sum()
        ),
        "mean_absolute_target_budget_error": float(overall_error.mean()),
        "max_target_budget_error": float(overall_error.max()),
        "mean_target_overallocation": float(overallocated.mean()),
        "mean_target_underallocation": float(underallocated.mean()),
        "mean_target_share_residual": float(valid.hierarchy_target_share_residual.mean()),
        "max_target_share_residual": float(valid.hierarchy_target_share_residual.max()),
    }
