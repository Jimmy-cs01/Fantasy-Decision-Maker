import unittest

import numpy as np
import pandas as pd

from scripts.projection_pipeline.evaluation_scoreboard import (
    chronological_quantile_calibration,
    chronological_empirical_confidence,
    ranking_metrics,
    regression_metrics,
    role_change_masks,
)


class ProjectionScoreboardTests(unittest.TestCase):
    def test_regression_metrics_include_catastrophic_misses_and_rank_correlation(self):
        result = regression_metrics(np.array([0.0, 10.0, 20.0]), np.array([0.0, 4.0, 40.0]))
        self.assertEqual(result["rows"], 3)
        self.assertAlmostEqual(result["absolute_error_gt_5"], 2 / 3, places=4)
        self.assertAlmostEqual(result["absolute_error_gt_15"], 1 / 3, places=4)
        self.assertEqual(result["spearman"], 1.0)

    def test_role_change_detection_uses_pregame_shifted_usage_only(self):
        frame = pd.DataFrame({
            "snap_pct_last_1": [0.75, 0.30, 0.50],
            "snap_pct_last_3": [0.50, 0.60, 0.50],
            "pbp_touches_l3": [10.0, 4.0, 8.0],
            "pbp_touches_season_avg": [6.0, 8.0, 8.0],
        })
        increase, decrease = role_change_masks(frame)
        self.assertEqual(increase.tolist(), [True, False, False])
        self.assertEqual(decrease.tolist(), [False, True, False])

    def test_weekly_rank_capture_and_start_sit_are_deterministic(self):
        frame = pd.DataFrame({
            "player_id": ["a", "b", "c"], "season": [2025] * 3, "week": [1] * 3,
            "historical_position": ["TE"] * 3, "fantasy_points_ppr": [20.0, 10.0, 0.0],
            "model": [18.0, 8.0, 2.0],
        })
        result = ranking_metrics(frame, "model")
        self.assertEqual(result["top_capture"]["TE"]["rate"], 1.0)
        self.assertEqual(result["start_sit"]["4+"]["accuracy"], 1.0)
        self.assertEqual(result["start_sit"]["4+"]["mean_regret"], 0.0)

    def test_quantile_calibration_never_uses_future_seasons(self):
        rows = []
        for season in (2022, 2023, 2024):
            for index in range(300):
                rows.append({
                    "player_id": f"{season}-{index}", "season": season, "week": index % 17 + 1,
                    "historical_position": "RB", "fantasy_points_ppr": float(index % 20),
                    "model": float(index % 20) + (100 if season == 2024 else 0),
                })
        result = chronological_quantile_calibration(pd.DataFrame(rows), "model")
        self.assertEqual(result["seasons"], [2023, 2024])
        self.assertEqual(result["rows"], 600)

    def test_empirical_confidence_is_fit_from_prior_seasons(self):
        rows = []
        for season in (2022, 2023, 2024):
            for index in range(300):
                actual = float(index % 20)
                rows.append({
                    "player_id": f"{season}-{index}", "season": season, "week": index % 17 + 1,
                    "historical_position": "RB", "fantasy_points_ppr": actual,
                    "career_games_before": index % 30, "snap_pct_last_1": 0.6,
                    "snap_pct_last_3": 0.6, "model": actual + (50 if season == 2024 else index % 3),
                })
        result = chronological_empirical_confidence(pd.DataFrame(rows), "model")
        self.assertEqual(result["rows"], 600)
        self.assertIn("buckets", result)


if __name__ == "__main__":
    unittest.main()
