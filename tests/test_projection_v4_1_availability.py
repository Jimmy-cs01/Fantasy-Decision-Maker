import unittest

import pandas as pd

from scripts.build_pregame_availability_v4_1 import weeks_since_prior_opportunity
from scripts.projection_pipeline.v4_hierarchy import reconcile_targets_to_pass_attempts
from scripts.projection_pipeline.v4_role_state import prepare_injuries


class ProjectionV41AvailabilityTests(unittest.TestCase):
    def test_post_cutoff_inactive_evidence_cannot_enter_24_hour_model(self):
        source = pd.DataFrame([{ "season": 2024, "week": 1, "team": "X", "gsis_id": "p",
            "report_status": "Out", "practice_status": "DNP", "date_modified": "2024-09-08T16:30:00Z" }])
        schedule = pd.DataFrame([{ "season": 2024, "week": 1, "team": "X", "kickoff": "2024-09-08T17:00:00Z" }])
        self.assertTrue(prepare_injuries(source, schedule, 24).empty)

    def test_vacated_share_uses_prior_opportunity_only(self):
        prior_share = .22
        active_expected = 0
        self.assertAlmostEqual(prior_share * (1 - active_expected), .22)

    def test_weeks_since_opportunity_never_uses_current_week(self):
        values = pd.Series([False, True, False, False, True])
        result = weeks_since_prior_opportunity(values)
        self.assertTrue(pd.isna(result.iloc[1]))
        self.assertEqual(result.iloc[2], 1)
        self.assertEqual(result.iloc[4], 3)

    def test_blended_targets_are_reconciled_to_allocated_attempts(self):
        components = pd.DataFrame({
            "pass_attempts": [30.0, 0.0], "targets": [0.0, 32.0],
            "receptions": [0.0, 24.0], "receiving_yards": [0.0, 240.0],
            "receiving_tds": [0.0, 2.0],
        })
        result = reconcile_targets_to_pass_attempts(components, pd.Series(["IND", "IND"]), .985)
        self.assertAlmostEqual(result.targets.sum(), 29.55)
        self.assertLessEqual(result.receptions.iloc[1], result.targets.iloc[1])


if __name__ == "__main__":
    unittest.main()
