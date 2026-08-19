"""End-to-end hierarchical opportunity and efficiency helpers for model v4."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class V4Prediction:
    ppr: np.ndarray
    direct_ppr: np.ndarray
    components: pd.DataFrame


def add_relative_room_features(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    keys = ["season", "week", "team", "historical_position"]
    sources = {
        "snap_pct_last_1": "room_snap_delta",
        "pbp_target_share_l3": "room_target_share_delta",
        "team_rush_share_l3": "room_rush_share_delta",
    }
    for source, target in sources.items():
        values = pd.to_numeric(output.get(source, 0), errors="coerce").fillna(0)
        output[target] = values - values.groupby([output[key] for key in keys]).transform("mean")
    output["room_depth_advantage"] = (
        output.groupby(keys, dropna=False).depth_rank_input.transform("max") - output.depth_rank_input
    )
    return output


def allocate_positive_shares(
    frame: pd.DataFrame,
    raw: np.ndarray,
    budget: pd.Series,
    eligible: pd.Series,
    maximum_modeled_share: float = .96,
) -> np.ndarray:
    """Allocate positive predicted shares without manufacturing residual volume."""
    result = np.zeros(len(frame), dtype=float)
    weights = np.maximum(0, np.asarray(raw, dtype=float))
    for _, indices in frame.loc[eligible].groupby(["season", "week", "team"], dropna=False).groups.items():
        idx = np.asarray(list(indices), dtype=int)
        total = float(weights[idx].sum())
        if total <= 0:
            continue
        scale = min(1.0, maximum_modeled_share / total)
        result[idx] = budget.iloc[idx].to_numpy(float) * weights[idx] * scale
    return result


def score_ppr(components: pd.DataFrame) -> np.ndarray:
    return (
        components.pass_yards.to_numpy(float) * .04
        + components.pass_tds.to_numpy(float) * 4
        - components.interceptions.to_numpy(float) * 2
        + components.rush_yards.to_numpy(float) * .1
        + components.rush_tds.to_numpy(float) * 6
        + components.receptions.to_numpy(float)
        + components.receiving_yards.to_numpy(float) * .1
        + components.receiving_tds.to_numpy(float) * 6
    )


def reconcile_targets_to_pass_attempts(
    components: pd.DataFrame, team: pd.Series, maximum_target_ratio: float = .985,
) -> pd.DataFrame:
    """Scale receiving components when a blended forecast outruns team attempts."""
    output = components.copy()
    team_pass = output.pass_attempts.groupby(team, dropna=False).transform("sum")
    team_targets = output.targets.groupby(team, dropna=False).transform("sum")
    scale = (team_pass * maximum_target_ratio / team_targets.replace(0, np.nan)).clip(upper=1).fillna(1)
    for column in ("targets", "receptions", "receiving_yards", "receiving_tds"):
        output[column] = output[column] * scale
    output["receptions"] = np.minimum(output.receptions, output.targets)
    return output


def coherent_components(
    frame: pd.DataFrame,
    pass_attempts: np.ndarray,
    rush_attempts: np.ndarray,
    targets: np.ndarray,
    rates: dict[str, np.ndarray],
) -> pd.DataFrame:
    pass_attempts = np.maximum(0, pass_attempts)
    rush_attempts = np.maximum(0, rush_attempts)
    targets = np.maximum(0, targets)
    completions = np.minimum(pass_attempts, pass_attempts * np.clip(rates["completion_rate"], .35, .82))
    receptions = np.minimum(targets, targets * np.clip(rates["catch_rate"], .25, .95))
    return pd.DataFrame({
        "pass_attempts": pass_attempts,
        "completions": completions,
        "pass_yards": pass_attempts * np.clip(rates["pass_yards_per_attempt"], 3, 11),
        "pass_tds": pass_attempts * np.clip(rates["pass_td_rate"], 0, .12),
        "interceptions": pass_attempts * np.clip(rates["interception_rate"], 0, .08),
        "rush_attempts": rush_attempts,
        "rush_yards": rush_attempts * np.clip(rates["rush_yards_per_attempt"], -1, 12),
        "rush_tds": rush_attempts * np.clip(rates["rush_td_rate"], 0, .2),
        "targets": targets,
        "receptions": receptions,
        "receiving_yards": targets * np.clip(rates["receiving_yards_per_target"], 0, 15),
        "receiving_tds": targets * np.clip(rates["receiving_td_rate"], 0, .18),
    }, index=frame.index)


def blend_components_to_direct(components: pd.DataFrame, direct: np.ndarray, weight: float) -> pd.DataFrame:
    """Bounded direct-model safety anchor that preserves exact component scoring."""
    if weight <= 0:
        return components
    output = components.copy()
    component_ppr = score_ppr(output)
    target = component_ppr * (1 - weight) + np.maximum(0, direct) * weight
    positive = component_ppr > 1e-6
    factor = np.ones(len(output))
    factor[positive] = np.clip(target[positive] / component_ppr[positive], .75, 1.25)
    for column in ("pass_yards", "pass_tds", "interceptions", "rush_yards", "rush_tds", "receptions", "receiving_yards", "receiving_tds"):
        output[column] *= factor
    output["receptions"] = np.minimum(output.receptions, output.targets)
    return output
