import tempfile
import unittest
from pathlib import Path

import pandas as pd

from scripts.projection_pipeline.v3_2_features import attach_shifted_snap_features, read_snap_weekly
from scripts.projection_pipeline.v3_2_model import role_confidence_with_snaps, snap_role_signal


def base_row(player="p", season=2024, week=1, team="A", position="RB", rushes=4, targets=1):
    return {
        "player_id": player, "season": season, "week": week, "season_type": "REG",
        "game_id": f"{season}_{week}_{team}", "team": team, "historical_position": position,
        "rush_attempts": rushes, "targets": targets, "true_touches": rushes,
        "career_games_before": 20, "true_touches_l8": 8, "true_touches_l3": 8,
        "prior_season_position_rank_pct": 0.5,
    }


def snap_row(player="p", season=2024, week=1, team="A", position="RB", snaps=30, team_snaps=60):
    return {
        "player_id": player, "season": season, "week": week, "season_type": "REG",
        "team": team, "historical_position": position, "offensive_snaps": snaps,
        "team_offensive_snaps": team_snaps, "offensive_snap_pct": snaps / team_snaps,
        "snap_source_row": 1,
    }


class ProjectionV32Tests(unittest.TestCase):
    def test_snap_percentage_scale_rejects_whole_percent_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snaps.csv"
            pd.DataFrame([snap_row(snaps=30, team_snaps=60) | {"offensive_snap_pct": 50.0}]).to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "0-1 scale"):
                read_snap_weekly(path)

    def test_week_n_snap_is_never_a_week_n_feature(self):
        base = pd.DataFrame([base_row(week=1), base_row(week=2), base_row(week=3)])
        snaps = pd.DataFrame([snap_row(week=1, snaps=12), snap_row(week=2, snaps=36), snap_row(week=3, snaps=60)])
        result = attach_shifted_snap_features(base, snaps).set_index("week")
        self.assertAlmostEqual(result.loc[3, "snap_pct_last_1"], 0.6)
        self.assertAlmostEqual(result.loc[3, "snap_pct_last_3"], 0.4)
        self.assertNotEqual(result.loc[3, "snap_pct_last_1"], 1.0)

    def test_rolling_five_and_season_boundary_use_prior_games(self):
        base = pd.DataFrame([
            base_row(season=2024, week=17), base_row(season=2024, week=18),
            base_row(season=2025, week=1),
        ])
        snaps = pd.DataFrame([
            snap_row(season=2024, week=17, snaps=30), snap_row(season=2024, week=18, snaps=42),
            snap_row(season=2025, week=1, snaps=54),
        ])
        result = attach_shifted_snap_features(base, snaps)
        week_one = result.loc[result.season.eq(2025)].iloc[0]
        self.assertAlmostEqual(week_one.snap_pct_last_5, 0.6)
        self.assertEqual(week_one.snap_prior_same_season, 0)

    def test_missing_is_neutral_and_distinct_from_observed_zero(self):
        base = pd.DataFrame([base_row(player="missing"), base_row(player="zero")])
        snaps = pd.DataFrame([snap_row(player="zero", snaps=0)])
        current = attach_shifted_snap_features(base, snaps)
        self.assertTrue(pd.isna(current.loc[current.player_id.eq("missing"), "offensive_snap_pct"].iloc[0]))
        self.assertEqual(current.loc[current.player_id.eq("zero"), "offensive_snap_pct"].iloc[0], 0)

    def test_rising_snaps_raise_bounded_role_signal(self):
        low = pd.Series({**base_row(), "snap_history_available": 1, "snap_pct_last_3": 0.2, "snap_pct_last_1": 0.2, "snap_pct_trend_3": 0, "snap_games_last_3": 3})
        high = low.copy()
        high[["snap_pct_last_3", "snap_pct_last_1", "snap_pct_trend_3"]] = [0.55, 0.7, 0.15]
        self.assertGreater(snap_role_signal(high, "RB"), snap_role_signal(low, "RB"))
        self.assertGreater(role_confidence_with_snaps(high, "RB"), role_confidence_with_snaps(low, "RB"))
        self.assertLessEqual(role_confidence_with_snaps(high, "RB"), 1)

    def test_high_snap_blocking_te_does_not_create_targets(self):
        row = pd.Series({
            **base_row(position="TE", rushes=0, targets=0),
            "targets_l8": 0, "targets_l3": 0, "depth_rank": 2,
            "snap_history_available": 1, "snap_pct_last_3": 0.9,
            "snap_pct_last_1": 0.9, "snap_pct_trend_3": 0,
            "snap_games_last_3": 3,
        })
        # Snaps can improve role certainty, but the helper returns confidence,
        # never targets or fantasy points.
        self.assertLess(role_confidence_with_snaps(row, "TE"), 0.7)

    def test_one_game_snap_spike_is_bounded(self):
        row = pd.Series({
            **base_row(), "snap_history_available": 1, "snap_pct_last_3": 0.25,
            "snap_pct_last_1": 0.85, "snap_pct_trend_3": 0.60,
            "snap_games_last_3": 1, "depth_rank": 3,
        })
        self.assertLess(snap_role_signal(row, "RB"), 1)
        self.assertLess(role_confidence_with_snaps(row, "RB"), 0.7)

    def test_current_depth_discounts_stale_previous_season_snaps(self):
        starter = pd.Series({
            **base_row(), "depth_rank": 1, "is_starter": True,
            "snap_history_available": 1, "snap_pct_last_3": 0.15,
            "snap_pct_last_1": 0.15, "snap_pct_trend_3": 0,
            "snap_games_last_3": 3, "snap_prior_same_season": 0,
        })
        buried = starter.copy()
        buried[["depth_rank", "is_starter"]] = [4, False]
        self.assertGreater(role_confidence_with_snaps(starter, "RB"), role_confidence_with_snaps(buried, "RB"))

    def test_demonstrated_usage_can_override_stale_depth_with_snap_context(self):
        low = pd.Series({
            **base_row(), "depth_rank": 3, "true_touches_l3": 1,
            "snap_history_available": 1, "snap_pct_last_3": 0.2,
            "snap_pct_last_1": 0.2, "snap_pct_trend_3": 0,
            "snap_games_last_3": 3,
        })
        demonstrated = low.copy()
        demonstrated[["true_touches_l3", "snap_pct_last_3", "snap_pct_last_1"]] = [15, 0.58, 0.62]
        self.assertGreater(role_confidence_with_snaps(demonstrated, "RB"), role_confidence_with_snaps(low, "RB"))


if __name__ == "__main__":
    unittest.main()
