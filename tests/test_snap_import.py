import unittest

import pandas as pd

from scripts.import_snap_counts import build_backfill, payloads


class SnapImportTests(unittest.TestCase):
    def setUp(self):
        self.keys = {"player_id": "p", "season": 2024, "week": 1, "season_type": "REG", "game_id": "g", "team": "X"}

    def test_backfill_matches_only_exact_player_game_team(self):
        snaps = pd.DataFrame([{**self.keys, "offensive_snaps": 40, "team_offensive_snaps": 60, "offensive_snap_pct": .67}])
        weekly = pd.DataFrame([self.keys, {**self.keys, "player_id": "other"}])
        matched, report = build_backfill(snaps, weekly)
        self.assertEqual((len(matched), report["matched_rows"]), (1, 1))

    def test_payload_updates_only_snap_and_identity_fields(self):
        frame = pd.DataFrame([{**self.keys, "offensive_snaps": 40, "team_offensive_snaps": 60, "offensive_snap_pct": .67}])
        row = payloads(frame, {"p": "uuid"})[0]
        self.assertEqual(row["player_id"], "uuid")
        self.assertEqual(row["team"], "X")
        self.assertEqual(row["offense_snap_percentage"], .67)
        self.assertNotIn("game_id", row)
        self.assertNotIn("fantasy_points_ppr", row)

    def test_invalid_percentage_is_rejected(self):
        snaps = pd.DataFrame([{**self.keys, "offensive_snaps": 40, "team_offensive_snaps": 60, "offensive_snap_pct": 67}])
        with self.assertRaisesRegex(ValueError, "0–1 scale"):
            build_backfill(snaps, pd.DataFrame([self.keys]))


if __name__ == "__main__":
    unittest.main()
