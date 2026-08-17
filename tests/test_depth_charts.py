import unittest

import pandas as pd

from scripts.download_nflverse_depth_charts import normalize_depth_chart


class DepthChartTests(unittest.TestCase):
    def test_latest_fantasy_rows_preserve_gsis_identity_and_role(self):
        rows = pd.DataFrame([
            {"dt": "2026-08-01T00:00:00Z", "team": "BAL", "player_name": "Old", "gsis_id": "old", "pos_grp": "3WR 1TE", "pos_abb": "RB", "pos_rank": 1},
            {"dt": "2026-08-16T00:00:00Z", "team": "BAL", "player_name": "Starter", "gsis_id": "starter", "pos_grp": "3WR 1TE", "pos_abb": "RB", "pos_rank": 1},
            {"dt": "2026-08-16T00:00:00Z", "team": "BAL", "player_name": "Backup", "gsis_id": "backup", "pos_grp": "3WR 1TE", "pos_abb": "RB", "pos_rank": 2},
            {"dt": "2026-08-16T00:00:00Z", "team": "BAL", "player_name": "Defender", "gsis_id": "def", "pos_grp": "Base 3-4 D", "pos_abb": "LB", "pos_rank": 1},
        ])
        result = normalize_depth_chart(rows, 2026, "2026-08-16T12:00:00Z")
        self.assertEqual(result.gsis_id.tolist(), ["starter", "backup"])
        self.assertEqual(result.depth_rank.tolist(), [1, 2])
        self.assertEqual(result.is_starter.tolist(), [True, False])
        self.assertEqual(set(result.provider), {"nflverse/ESPN"})


if __name__ == "__main__":
    unittest.main()
