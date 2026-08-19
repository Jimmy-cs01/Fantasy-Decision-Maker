import unittest

import numpy as np
import pandas as pd

from scripts.projection_pipeline.v4_hierarchy import (
    allocate_positive_shares, blend_components_to_direct, coherent_components, score_ppr,
)


class ProjectionV4Tests(unittest.TestCase):
    def test_share_allocator_preserves_other_bucket(self):
        frame = pd.DataFrame([
            {"season": 2024, "week": 1, "team": "X"},
            {"season": 2024, "week": 1, "team": "X"},
        ])
        allocated = allocate_positive_shares(frame, np.array([.4, .4]), pd.Series([30, 30]), pd.Series([True, True]))
        self.assertAlmostEqual(allocated.sum(), 24)

    def test_component_scoring_is_exact_and_coherent(self):
        frame = pd.DataFrame([{}])
        rates = {"completion_rate": np.array([.65]), "pass_yards_per_attempt": np.array([7]),
            "pass_td_rate": np.array([.05]), "interception_rate": np.array([.02]),
            "rush_yards_per_attempt": np.array([4]), "rush_td_rate": np.array([.03]),
            "catch_rate": np.array([.7]), "receiving_yards_per_target": np.array([7]),
            "receiving_td_rate": np.array([.04])}
        components = coherent_components(frame, np.array([30]), np.array([5]), np.array([0]), rates)
        self.assertLessEqual(components.completions.iloc[0], components.pass_attempts.iloc[0])
        self.assertGreater(score_ppr(components)[0], 0)

    def test_direct_anchor_recomputes_from_components(self):
        components = pd.DataFrame([{ "pass_attempts": 0, "completions": 0, "pass_yards": 0,
            "pass_tds": 0, "interceptions": 0, "rush_attempts": 10, "rush_yards": 40,
            "rush_tds": .2, "targets": 3, "receptions": 2, "receiving_yards": 20,
            "receiving_tds": .1 }])
        blended = blend_components_to_direct(components, np.array([12.0]), .2)
        self.assertAlmostEqual(float(score_ppr(blended)[0]), float(score_ppr(blended)[0]), places=10)
        self.assertLessEqual(blended.receptions.iloc[0], blended.targets.iloc[0])


if __name__ == "__main__":
    unittest.main()
