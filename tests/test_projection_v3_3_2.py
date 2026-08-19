import unittest

import pandas as pd

from scripts.projection_pipeline.v3_3_2_model import (
    PassingHierarchyConfig,
    allocate_team_passing_hierarchy,
    direct_safety_eligible_mask,
    passing_coherence_metrics,
)


def role_confidence(_row, _position):
    return 1.0


class ProjectionV332Tests(unittest.TestCase):
    def frame(self):
        return pd.DataFrame([
            {"season": 2026, "week": 1, "team": "NE", "historical_position": "QB", "is_starter": "True", "depth_rank": 1},
            {"season": 2026, "week": 1, "team": "NE", "historical_position": "QB", "is_starter": "False", "depth_rank": 2},
            {"season": 2026, "week": 1, "team": "NE", "historical_position": "WR", "is_starter": True, "depth_rank": 1},
            {"season": 2026, "week": 1, "team": "NE", "historical_position": "TE", "is_starter": True, "depth_rank": 1},
        ])

    def audit(self):
        return pd.DataFrame([{
            "season": 2026,
            "week": 1,
            "team": "NE",
            "pass_attempt_budget": 30.0,
        }])

    def test_overallocated_targets_are_capped_to_empirical_budget(self):
        predictions = [
            {"pass_attempts": 24.0},
            {"pass_attempts": 6.0},
            {"targets": 25.0},
            {"targets": 15.0},
        ]
        result, audit = allocate_team_passing_hierarchy(
            self.frame(), predictions, self.audit(), role_confidence,
            config=PassingHierarchyConfig(qb_budget_refill=0.0),
        )
        expected = 30.0 * PassingHierarchyConfig().targets_per_attempt * PassingHierarchyConfig().modeled_target_coverage
        self.assertAlmostEqual(result[2]["targets"] + result[3]["targets"], expected)
        self.assertEqual(passing_coherence_metrics(audit)["material_target_overallocation"], 0)

    def test_underallocated_targets_remain_residual_other_volume(self):
        predictions = [
            {"pass_attempts": 24.0},
            {"pass_attempts": 6.0},
            {"targets": 8.0},
            {"targets": 5.0},
        ]
        result, audit = allocate_team_passing_hierarchy(
            self.frame(), predictions, self.audit(), role_confidence,
            config=PassingHierarchyConfig(qb_budget_refill=0.0),
        )
        self.assertEqual(result[2]["targets"] + result[3]["targets"], 13.0)
        self.assertGreater(float(audit.iloc[0].hierarchy_other_targets), 0)

    def test_clear_starter_dominates_refilled_qb_budget(self):
        predictions = [
            {"pass_attempts": 15.0},
            {"pass_attempts": 12.0},
            {"targets": 8.0},
            {"targets": 5.0},
        ]
        result, _ = allocate_team_passing_hierarchy(
            self.frame(), predictions, self.audit(), role_confidence,
            config=PassingHierarchyConfig(qb_budget_refill=1.0, starter_attempt_share=0.96),
        )
        self.assertAlmostEqual(result[0]["pass_attempts"], 28.8)
        self.assertAlmostEqual(result[1]["pass_attempts"], 1.2)

    def test_missing_qb_data_is_neutral_not_zero(self):
        frame = self.frame().iloc[2:].reset_index(drop=True)
        predictions = [{"targets": 8.0}, {"targets": 5.0}]
        result, audit = allocate_team_passing_hierarchy(
            frame, predictions, self.audit(), role_confidence,
        )
        self.assertEqual([row["targets"] for row in result], [8.0, 5.0])
        self.assertTrue(bool(audit.iloc[0].hierarchy_missing_qb))

    def test_direct_safety_cannot_bypass_explicit_backup_role(self):
        eligible = direct_safety_eligible_mask(self.frame())
        self.assertTrue(bool(eligible[0]))
        self.assertFalse(bool(eligible[1]))


if __name__ == "__main__":
    unittest.main()
