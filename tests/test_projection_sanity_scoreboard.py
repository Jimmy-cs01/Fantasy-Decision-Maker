import json
import unittest

import pandas as pd

from scripts.projection_pipeline.sanity_scoreboard import current_projection_sanity


class ProjectionSanityScoreboardTests(unittest.TestCase):
    def row(self, **overrides):
        stats = {
            "pass_attempts": 32, "completions": 21, "targets": 0, "receptions": 0,
            "rush_attempts": 5, "passing_yards": 240, "passing_touchdowns": 1.5,
            "interceptions_thrown": 0.5, "rushing_yards": 25, "rushing_touchdowns": 0.2,
        }
        base = {
            "gsis_id": "p1", "player_name": "QB One", "position": "QB", "team": "BUF",
            "depth_rank": 1, "is_starter": True, "projected_stats": json.dumps(stats),
            "model_projection_ppr": 18.3,
        }
        base.update(overrides)
        return base

    def test_coherent_starter_passes_component_and_qb_sanity(self):
        report = current_projection_sanity(pd.DataFrame([self.row()]))
        self.assertEqual(report["violations"]["component_ppr_mismatch"]["count"], 0)
        self.assertEqual(report["violations"]["starting_qb_below_18_attempts"]["count"], 0)

    def test_lamar_style_downstream_collapse_is_severe(self):
        stats = {
            "pass_attempts": 15, "completions": 10, "passing_yards": 110,
            "passing_touchdowns": 0.3, "interceptions_thrown": 0.2,
            "rush_attempts": 4, "rushing_yards": 20, "rushing_touchdowns": 0.03,
        }
        row = self.row(projected_stats=json.dumps(stats), model_projection_ppr=7.222)
        report = current_projection_sanity(pd.DataFrame([row]))
        self.assertEqual(report["violations"]["starting_qb_below_8_ppg"]["count"], 1)
        self.assertEqual(report["violations"]["starting_qb_below_18_attempts"]["count"], 1)
        self.assertFalse(report["promotion_safe"])

    def test_impossible_component_relationships_are_flagged(self):
        stats = {"targets": 2, "receptions": 3, "receiving_yards": 20}
        report = current_projection_sanity(pd.DataFrame([
            self.row(position="WR", depth_rank=1, projected_stats=json.dumps(stats), model_projection_ppr=5),
        ]))
        self.assertEqual(report["violations"]["receptions_exceed_targets"]["count"], 1)


if __name__ == "__main__":
    unittest.main()
