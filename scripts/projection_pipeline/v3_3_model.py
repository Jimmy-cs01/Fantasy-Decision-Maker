from __future__ import annotations

import numpy as np
import pandas as pd

from .v3_3_config import (
    DECLINING_ROLE_SNAP_DELTA,
    ESTABLISHED_STARTER_MAX_DROP,
    ESTABLISHED_STARTER_MIN_GAMES,
    ESTABLISHED_STARTER_MIN_RANK_PERCENTILE,
    ESTABLISHED_STARTER_MIN_SNAP,
    RISING_ROLE_SNAP_DELTA,
    RISING_ROLE_V3_2_WEIGHT,
)


def snap_delta(frame: pd.DataFrame) -> pd.Series:
    return frame["snap_pct_last_1"] - frame["snap_pct_last_3"]


def rising_role_mask(frame: pd.DataFrame) -> pd.Series:
    """Leakage-safe role expansion derived only from shifted snap inputs."""
    delta = snap_delta(frame)
    return frame["snap_pct_last_1"].notna() & frame["snap_pct_last_3"].notna() & delta.ge(RISING_ROLE_SNAP_DELTA)


def declining_role_mask(frame: pd.DataFrame) -> pd.Series:
    delta = snap_delta(frame)
    return frame["snap_pct_last_1"].notna() & frame["snap_pct_last_3"].notna() & delta.le(DECLINING_ROLE_SNAP_DELTA)


def established_starter_mask(frame: pd.DataFrame) -> pd.Series:
    """Stable, demonstrated starters eligible for a bounded historical anchor."""
    starter = (
        frame["career_games_before"].fillna(0).ge(ESTABLISHED_STARTER_MIN_GAMES)
        & frame["prior_season_position_rank_pct"].fillna(0).ge(ESTABLISHED_STARTER_MIN_RANK_PERCENTILE)
        & frame["snap_pct_last_1"].fillna(-1).ge(ESTABLISHED_STARTER_MIN_SNAP)
    )
    # A falling role is affirmative evidence, so v3.2 keeps its full ability
    # to move an established player downward.
    return starter & ~declining_role_mask(frame)


def apply_role_corrections(
    frame: pd.DataFrame,
    v3_1: np.ndarray,
    v3_2: np.ndarray,
    rising_weight: float = RISING_ROLE_V3_2_WEIGHT,
    starter_margin: float = ESTABLISHED_STARTER_MAX_DROP,
) -> tuple[np.ndarray, dict[str, int]]:
    """Apply the two validation-selected, monotonic v3.3 corrections."""
    corrected = np.asarray(v3_2, dtype=float).copy()
    baseline = np.asarray(v3_1, dtype=float)
    rising = rising_role_mask(frame).to_numpy()
    corrected[rising] = baseline[rising] * (1 - rising_weight) + corrected[rising] * rising_weight
    established = established_starter_mask(frame).to_numpy()
    corrected[established] = np.maximum(corrected[established], baseline[established] - starter_margin)
    return np.maximum(0, corrected), {
        "rising_role_rows": int(rising.sum()),
        "established_anchor_rows": int(established.sum()),
    }

