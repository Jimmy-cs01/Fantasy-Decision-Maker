from __future__ import annotations

import numpy as np
import pandas as pd

from .v3_1_model import role_confidence


def snap_role_signal(row: pd.Series, position: str) -> float | None:
    if not bool(row.get("snap_history_available", 0)):
        return None
    recent = row.get("snap_pct_last_3")
    prior = row.get("snap_pct_last_1")
    if pd.isna(recent) and pd.isna(prior):
        return None
    level = float(recent if pd.notna(recent) else prior)
    trend = 0.0 if pd.isna(row.get("snap_pct_trend_3")) else float(row["snap_pct_trend_3"])
    samples = float(row.get("snap_games_last_3", 0) or 0)
    stability = min(1.0, samples / 3.0)
    position_center = {"QB": 0.92, "RB": 0.52, "WR": 0.72, "TE": 0.68}[position]
    level_signal = float(np.clip(level / position_center, 0, 1))
    bounded_trend = float(np.clip(trend, -0.20, 0.20))
    signal = level_signal + bounded_trend * 0.35 * stability
    if row.get("snap_prior_same_team") == 0:
        signal = 0.5 + (signal - 0.5) * 0.35
    if row.get("snap_prior_same_season") == 0:
        signal = 0.5 + (signal - 0.5) * 0.65
    return float(np.clip(signal, 0.01, 1.0))


def role_confidence_with_snaps(row: pd.Series, position: str) -> float:
    base = role_confidence(row, position)
    snap = snap_role_signal(row, position)
    if snap is None:
        return base
    samples = min(1.0, float(row.get("snap_games_last_3", 0) or 0) / 3.0)
    # Snaps refine role confidence but never replace depth/usage. The bounded
    # 25% weight prevents a single injury/game-script appearance dominating.
    snap_weight = 0.10 + 0.15 * samples
    return float(np.clip(base * (1 - snap_weight) + snap * snap_weight, 0.01, 1.0))

