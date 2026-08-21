import numpy as np
import pandas as pd

from scripts.projection_pipeline.v4_consensus import (
    adaptive_consensus_weight,
    apply_v4_historical_safety,
)


def frame(position="QB", games=40, snap=.9, percentile=.9, rush=7):
    return pd.DataFrame([{
        "historical_position": position, "career_games_before": games,
        "snap_pct_last_1": snap, "prior_season_position_rank_pct": percentile,
        "rush_attempts_season_avg": rush, "rush_attempts_l5": rush,
        "rush_attempts_l8": rush, "fantasy_points_ppr_season_avg": 22,
        "fantasy_points_ppr_l5": 21, "fantasy_points_ppr_l8": 22,
        "prior_season_ppr_ppg": 22,
    }])


def test_stable_elite_collapse_uses_baseline_not_a_name_rule():
    result = apply_v4_historical_safety(frame(), np.array([20.0]), np.array([15.0]))
    assert result[0] == 20.2


def test_changed_or_low_history_role_is_not_anchored():
    result = apply_v4_historical_safety(frame(games=3, snap=.2), np.array([20.0]), np.array([15.0]))
    assert result[0] == 15.0


def test_consensus_weight_is_confidence_and_corroboration_aware():
    low = adaptive_consensus_weight(confidence="low", role_secure=True, disagreement=8, sources=2)
    high = adaptive_consensus_weight(confidence="high", role_secure=True, disagreement=8, sources=1)
    assert low > high
    assert adaptive_consensus_weight(confidence="low", role_secure=False, disagreement=20, sources=2) == 0
