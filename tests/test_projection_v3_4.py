import unittest

import pandas as pd

from scripts.projection_pipeline.v3_4_model import LearnedShareConfig, allocate_learned_shares
from scripts.train_role_change_detector_v3_4 import role_labels


def confidence(_row, _position):
    return 1.0


class ProjectionV34Tests(unittest.TestCase):
    def test_role_labels_compare_current_outcome_only_to_pregame_l8(self):
        frame = pd.DataFrame([{
            "historical_position": "RB", "pbp_touches": 18, "pbp_touches_l8": 8,
            "pbp_pass_attempts": 0, "pbp_pass_attempts_l8": 0,
            "pbp_targets": 0, "pbp_targets_l8": 0,
        }])
        self.assertEqual(int(role_labels(frame).iloc[0]), 2)

    def test_learned_shares_preserve_assigned_volume_without_refill(self):
        frame = pd.DataFrame([
            {"season": 2025, "week": 2, "team": "X", "historical_position": "QB"},
            {"season": 2025, "week": 2, "team": "X", "historical_position": "WR", "_learned_target_share": .8},
            {"season": 2025, "week": 2, "team": "X", "historical_position": "TE", "_learned_target_share": .2},
        ])
        predictions = [{"pass_attempts": 30}, {"targets": 6}, {"targets": 4}]
        audit = pd.DataFrame([{
            "season": 2025, "week": 2, "team": "X", "pass_attempt_budget": 35,
            "rb_carry_budget": 20, "target_budget": 30, "targets_before": 10,
            "targets_after": 10, "rb_carries_before": 0, "rb_carries_after": 0,
            "pass_attempts_before": 30, "pass_attempts_after": 30,
        }])
        output, _ = allocate_learned_shares(
            frame, predictions, audit, confidence, config=LearnedShareConfig(1.0),
        )
        self.assertAlmostEqual(output[1]["targets"] + output[2]["targets"], 10)
        self.assertAlmostEqual(output[1]["targets"], 8)

    def test_partial_team_volume_blend_is_bounded(self):
        config = LearnedShareConfig(0, None, 0, True, .25)
        self.assertGreaterEqual(config.team_volume_weight, 0)
        self.assertLessEqual(config.team_volume_weight, 1)


if __name__ == "__main__":
    unittest.main()
