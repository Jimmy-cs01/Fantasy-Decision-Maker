"""Leakage-safe v4 top-end calibration helpers.

Sleeper and live markets are intentionally absent here: historical validation
may only use evidence that existed before the game. Current consensus is a
separate inference-only diagnostic until archived snapshots are available.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def historical_ppr_prior(frame: pd.DataFrame, fallback: np.ndarray) -> np.ndarray:
    columns = [
        "fantasy_points_ppr_season_avg", "fantasy_points_ppr_l5",
        "fantasy_points_ppr_l8", "prior_season_ppr_ppg",
    ]
    return frame[columns].median(axis=1, skipna=True).fillna(pd.Series(fallback, index=frame.index)).to_numpy(float)


def historical_qb_rush_attempt_prior(frame: pd.DataFrame) -> np.ndarray:
    return frame[["rush_attempts_season_avg", "rush_attempts_l5", "rush_attempts_l8"]].median(axis=1, skipna=True).fillna(0).to_numpy(float)


def stable_elite_mask(frame: pd.DataFrame) -> np.ndarray:
    return (
        frame.career_games_before.ge(17)
        & frame.snap_pct_last_1.fillna(0).ge(.70)
        & frame.prior_season_position_rank_pct.fillna(0).ge(.75)
    ).to_numpy()


def apply_v4_historical_safety(frame: pd.DataFrame, baseline: np.ndarray, hierarchical: np.ndarray) -> np.ndarray:
    """Protect stable elites from a large hierarchy-only collapse.

    The 1.5 PPG disagreement threshold and 10% QB prior weight were frozen from
    pre-2026 rolling-fold analysis. This does not enforce a minimum projection.
    """
    output = np.asarray(hierarchical, dtype=float).copy()
    baseline = np.asarray(baseline, dtype=float)
    protected = stable_elite_mask(frame) & (output < baseline - 1.5)
    output[protected] = baseline[protected]

    rush_prior = historical_qb_rush_attempt_prior(frame)
    ppr_prior = historical_ppr_prior(frame, output)
    dual_threat = (
        frame.historical_position.eq("QB").to_numpy()
        & frame.career_games_before.ge(17).to_numpy()
        & (rush_prior >= 5)
        & (ppr_prior > output)
    )
    output[dual_threat] += .10 * (ppr_prior[dual_threat] - output[dual_threat])
    return output


def adaptive_consensus_weight(*, confidence: str, role_secure: bool, disagreement: float, sources: int) -> float:
    """Current-only consensus weight; never used as a historical target."""
    if sources <= 0 or not role_secure:
        return 0.0
    base = {"high": .12, "medium": .22, "low": .34}.get(confidence.lower(), .22)
    severity = min(.16, max(0.0, disagreement - 3) * .025)
    corroboration = .08 if sources >= 2 else 0.0
    return float(np.clip(base + severity + corroboration, 0, .55))
