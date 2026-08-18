import unittest

import pandas as pd

from scripts.import_nfl_schedules import build_games
from scripts.projection_pipeline.schedules import normalize_schedules


class NflScheduleTests(unittest.TestCase):
    def test_normalizes_kickoff_and_builds_one_canonical_game(self):
        source = pd.DataFrame([{
            "game_id": "2026_01_KC_BUF", "season": 2026, "game_type": "REG", "week": 1,
            "gameday": "2026-09-13", "gametime": "16:25", "weekday": "Sunday",
            "away_team": "KC", "home_team": "BUF", "location": "Home",
            "away_rest": 7, "home_rest": 7,
        }])
        normalized = normalize_schedules(source, 2026)
        games = build_games(normalized)
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["home_team"], "BUF")
        self.assertEqual(games[0]["away_team"], "KC")
        self.assertEqual(games[0]["kickoff"], "2026-09-13T20:25:00+00:00")

    def test_rejects_schedule_without_both_team_rows(self):
        frame = pd.DataFrame([{
            "game_id": "bad", "season": 2026, "week": 1, "season_type": "REG",
            "team": "BUF", "opponent_team": "KC", "is_home": 1,
            "neutral_site": 0, "kickoff": "2026-09-13T20:25:00Z",
        }])
        with self.assertRaisesRegex(ValueError, "exactly one home and away"):
            build_games(frame)


if __name__ == "__main__":
    unittest.main()
