import unittest

import pandas as pd

from scripts.projection_pipeline.v3_3_2_role_experiment import (
    RoleShareConfig,
    allocate_role_shares,
    role_change_strength,
)


def confidence(_row, _position):
    return 1.0


class RoleOpportunityExperimentTests(unittest.TestCase):
    def test_role_change_uses_shifted_inputs(self):
        row = pd.Series({
            "pbp_target_share_l3": .30, "pbp_target_share_l8": .10,
            "snap_pct_delta_1": .20,
        })
        self.assertEqual(role_change_strength(row, "WR"), 1.0)
        self.assertNotIn("pbp_target_share", row.index)

    def test_share_allocator_preserves_team_budgets(self):
        frame = pd.DataFrame([
            {"season": 2025, "week": 4, "team": "X", "historical_position": "QB", "pbp_target_share_l3": 0},
            {"season": 2025, "week": 4, "team": "X", "historical_position": "RB", "pbp_target_share_l3": .20, "team_rush_share_l3": .65},
            {"season": 2025, "week": 4, "team": "X", "historical_position": "RB", "pbp_target_share_l3": .10, "team_rush_share_l3": .20},
            {"season": 2025, "week": 4, "team": "X", "historical_position": "WR", "pbp_target_share_l3": .30},
        ])
        predictions = [
            {"pass_attempts": 30, "rush_attempts": 3},
            {"rush_attempts": 8, "targets": 2},
            {"rush_attempts": 8, "targets": 2},
            {"rush_attempts": 0, "targets": 5},
        ]
        audit = pd.DataFrame([{
            "season": 2025, "week": 4, "team": "X",
            "pass_attempt_budget": 32, "rb_carry_budget": 20,
            "target_budget": 30, "targets_before": 9, "targets_after": 9,
            "rb_carries_before": 16, "rb_carries_after": 16,
            "pass_attempts_before": 30, "pass_attempts_after": 30,
        }])
        output, result = allocate_role_shares(frame, predictions, audit, confidence)
        expected_targets = 30 * .911765 * .991322
        self.assertAlmostEqual(sum(row.get("targets", 0) for row in output), expected_targets)
        self.assertAlmostEqual(sum(output[i].get("rush_attempts", 0) for i in (1, 2)), 20)
        self.assertAlmostEqual(float(result.iloc[0].role_share_other_targets), 0)

    def test_missing_recent_share_is_neutral_not_zero_role(self):
        frame = pd.DataFrame([
            {"season": 2025, "week": 4, "team": "X", "historical_position": "QB"},
            {"season": 2025, "week": 4, "team": "X", "historical_position": "WR"},
        ])
        predictions = [{"pass_attempts": 30}, {"targets": 7}]
        audit = pd.DataFrame([{
            "season": 2025, "week": 4, "team": "X", "pass_attempt_budget": 30,
            "rb_carry_budget": 20, "target_budget": 28,
            "targets_before": 7, "targets_after": 7, "rb_carries_before": 0,
            "rb_carries_after": 0, "pass_attempts_before": 30, "pass_attempts_after": 30,
        }])
        output, _ = allocate_role_shares(frame, predictions, audit, confidence)
        self.assertGreater(output[1]["targets"], 0)


if __name__ == "__main__":
    unittest.main()
