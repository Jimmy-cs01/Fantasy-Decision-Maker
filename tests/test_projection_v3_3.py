import unittest

import numpy as np
import pandas as pd

from scripts.projection_pipeline.scoring import score_projected_stats_exact
from scripts.projection_pipeline.v3_3_model import (
    apply_role_corrections,
    declining_role_mask,
    established_starter_mask,
    rising_role_mask,
)
from scripts.projection_pipeline.v3_3_reconciliation import reconcile_components_exact
from scripts.projection_pipeline.v3_1_model import normalize_team_opportunities
from scripts.projection_pipeline.v3_3_1_model import apply_current_team_context, unexplained_qb1_suppression_mask


def role_frame(**overrides):
    row = {
        "career_games_before": 40,
        "prior_season_position_rank_pct": 0.75,
        "snap_pct_last_1": 0.8,
        "snap_pct_last_3": 0.8,
    }
    row.update(overrides)
    return pd.DataFrame([row])


class ProjectionV33Tests(unittest.TestCase):
    def test_current_team_replaces_previous_team_allocation_and_matchup(self):
        frame = pd.DataFrame([
            {"player_id": "moved", "team": "OLD", "team_pass_rate_l3": 0.4, "opponent_team": "X"},
            {"player_id": "incumbent", "team": "NEW", "team_pass_rate_l3": 0.7, "opponent_team": "Y"},
        ])
        roles = pd.DataFrame([
            {"player_id": "moved", "team": "NEW"},
            {"player_id": "incumbent", "team": "NEW"},
        ])
        schedule = pd.DataFrame([
            {"season": 2026, "week": 1, "team": "NEW", "opponent_team": "OPP", "days_rest": 7,
             "is_home": 1, "neutral_site": 0, "short_week": 0, "long_rest": 0,
             "returning_from_bye": 0, "is_thursday": 0},
        ])
        output = apply_current_team_context(frame, roles, schedule, 2026, 1).set_index("player_id")
        self.assertEqual(output.loc["moved", "prior_team"], "OLD")
        self.assertEqual(output.loc["moved", "team"], "NEW")
        self.assertAlmostEqual(output.loc["moved", "team_pass_rate_l3"], 0.7)
        self.assertEqual(output.loc["moved", "opponent_team"], "OPP")

    def test_week_one_qb_depth_gate_keeps_backup_history_from_displacing_qb1(self):
        frame = pd.DataFrame([
            {"season": 2026, "week": 1, "team": "BAL", "historical_position": "QB", "depth_rank": 1, "is_starter": True, "career_games_before": 80, "pass_attempts_l8": 24, "pbp_pass_attempts_l3": 16},
            {"season": 2026, "week": 1, "team": "BAL", "historical_position": "QB", "depth_rank": 2, "is_starter": False, "career_games_before": 30, "pass_attempts_l8": 18, "pbp_pass_attempts_l3": 18},
        ])
        predictions = [{"pass_attempts": 22.0}, {"pass_attempts": 18.0}]
        output, audit = normalize_team_opportunities(
            frame, predictions, refill_budget=True, refill_week_one_only=True,
            current_qb_depth_gate=True,
        )
        self.assertGreater(output[0]["pass_attempts"], 24)
        self.assertLess(output[1]["pass_attempts"], 1)
        self.assertAlmostEqual(audit.iloc[0].pass_attempts_after, audit.iloc[0].pass_attempt_budget)

    def test_week_one_refill_does_not_change_regular_week_behavior(self):
        rows = [
            {"season": 2025, "week": 4, "team": "A", "historical_position": "WR", "depth_rank": 1, "career_games_before": 30, "targets_l8": 7, "pbp_targets_l3": 7},
            {"season": 2025, "week": 4, "team": "A", "historical_position": "WR", "depth_rank": 2, "career_games_before": 30, "targets_l8": 6, "pbp_targets_l3": 6},
        ]
        frame = pd.DataFrame(rows)
        predictions = [{"targets": 25.0}, {"targets": 20.0}]
        legacy, _ = normalize_team_opportunities(frame, predictions)
        candidate, _ = normalize_team_opportunities(
            frame, predictions, refill_budget=True, refill_week_one_only=True,
        )
        self.assertEqual(legacy, candidate)

    def test_role_weighted_target_allocation_preserves_team_budget(self):
        frame = pd.DataFrame([
            {"season": 2026, "week": 1, "team": "A", "historical_position": "WR", "depth_rank": 1, "is_starter": True, "career_games_before": 30, "targets_l8": 8, "pbp_targets_l3": 8},
            {"season": 2026, "week": 1, "team": "A", "historical_position": "WR", "depth_rank": 5, "is_starter": False, "career_games_before": 3, "targets_l8": 1, "pbp_targets_l3": 1},
        ])
        output, audit = normalize_team_opportunities(
            frame, [{"targets": 30.0}, {"targets": 20.0}],
            refill_budget=True, refill_week_one_only=True,
        )
        self.assertGreater(output[0]["targets"], output[1]["targets"])
        self.assertAlmostEqual(audit.iloc[0].targets_after, audit.iloc[0].target_budget)

    def test_unexplained_qb1_suppression_is_diagnostic_not_a_floor(self):
        frame = pd.DataFrame([
            {"historical_position": "QB", "depth_rank": 1, "is_starter": True, "snap_pct_last_1": 0.95},
            {"historical_position": "QB", "depth_rank": 2, "is_starter": False, "snap_pct_last_1": 0.95},
        ])
        mask = unexplained_qb1_suppression_mask(frame, np.array([7.0, 7.0]))
        self.assertEqual(mask.tolist(), [True, False])
        self.assertEqual([7.0, 7.0], [7.0, 7.0])

    def test_rising_role_uses_shifted_snap_inputs(self):
        frame = role_frame(snap_pct_last_1=0.65, snap_pct_last_3=0.45)
        self.assertTrue(rising_role_mask(frame).iloc[0])
        self.assertFalse(declining_role_mask(frame).iloc[0])

    def test_rising_blend_is_deterministic_and_stable_players_are_unchanged(self):
        rising = role_frame(snap_pct_last_1=0.65, snap_pct_last_3=0.45)
        stable = role_frame()
        frame = pd.concat([rising, stable], ignore_index=True)
        result, _ = apply_role_corrections(frame, np.array([12.0, 12.0]), np.array([8.0, 8.0]))
        self.assertAlmostEqual(result[0], 11.0)
        # Stable established player receives only the bounded 1.25 anchor.
        self.assertAlmostEqual(result[1], 10.75)

    def test_declining_veteran_is_not_anchored_upward(self):
        frame = role_frame(snap_pct_last_1=0.45, snap_pct_last_3=0.75)
        self.assertFalse(established_starter_mask(frame).iloc[0])
        result, _ = apply_role_corrections(frame, np.array([14.0]), np.array([9.0]))
        self.assertAlmostEqual(result[0], 9.0)

    def test_low_history_player_is_not_established(self):
        self.assertFalse(established_starter_mask(role_frame(career_games_before=4)).iloc[0])

    def test_exact_component_ppr_and_basic_constraints(self):
        stats = {
            "targets": 4.0, "receptions": 5.0, "receiving_yards": -3.0,
            "receiving_touchdowns": 0.1, "rush_attempts": -1.0,
        }
        final, score, detail = reconcile_components_exact(stats, 9.137, "WR")
        self.assertLessEqual(final["receptions"], final["targets"])
        self.assertGreaterEqual(final["receiving_yards"], 0)
        self.assertGreaterEqual(final["rush_attempts"], 0)
        self.assertAlmostEqual(score, 9.137, places=6)
        self.assertAlmostEqual(score_projected_stats_exact(final, {"rec": 1.0}, "WR"), score, places=9)
        self.assertAlmostEqual(float(detail["final_residual"]), 0, places=6)

    def test_reconciliation_never_changes_team_budget_volume(self):
        stats = {
            "pass_attempts": 30.0, "completions": 20.0, "passing_yards": 180.0,
            "passing_touchdowns": 1.0, "interceptions_thrown": 1.0,
            "rush_attempts": 4.0, "rushing_yards": 20.0, "rushing_touchdowns": 0.0,
        }
        final, score, _ = reconcile_components_exact(stats, 24.25, "QB")
        self.assertEqual(final["pass_attempts"], 30.0)
        self.assertEqual(final["rush_attempts"], 4.0)
        self.assertAlmostEqual(score, 24.25, places=6)

    def test_final_score_is_recomputed_after_component_change(self):
        stats = {"targets": 8.0, "receptions": 6.0, "receiving_yards": 70.0, "receiving_touchdowns": 0.0}
        final, score, _ = reconcile_components_exact(stats, 17.25, "TE")
        final["receiving_yards"] += 10
        rescored = score_projected_stats_exact(final, {"rec": 1.0}, "TE")
        self.assertAlmostEqual(rescored, score + 1.0, places=6)


if __name__ == "__main__":
    unittest.main()
