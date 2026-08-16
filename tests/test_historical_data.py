import unittest

import pandas as pd

from scripts import build_historical_weekly_stats as etl
from scripts import match_sleeper_players as matcher


class PlayerMappingTests(unittest.TestCase):
    def test_name_and_suffix_normalization(self):
        self.assertEqual(matcher.normalize_name("D'Andre O’Neil-Jr."), "dandre oneiljr")
        self.assertEqual(matcher.normalize_name("Robert Griffin III", remove_suffix=True), "robert griffin")

    def test_manual_unmatched_never_receives_sleeper_id(self):
        kaggle = {"player_id": "x", "pfr_player_id": "", "player_name": "Test", "historical_position": "WR", "position_group": "WR", "historical_team": "", "birth_date": "", "height": None, "weight": None, "college_name": "", "rookie_season": None}
        row = matcher.apply_override(kaggle, {"action": "unmatched", "sleeper_player_id": ""}, {})
        self.assertEqual(row["match_method"], "manual_unmatched")
        self.assertEqual(row["confidence"], "unmatched")
        self.assertEqual(row["sleeper_player_id"], "")

    def test_position_change_can_match_with_strong_metadata(self):
        kaggle = {"player_id": "x", "pfr_player_id": "", "player_name": "Juwan Johnson", "historical_position": "WR", "position_group": "WR", "historical_team": "NO", "birth_date": "1996-09-13", "height": 76, "weight": 231, "college_name": "Oregon; Penn State", "college": "oregon penn state", "rookie_season": 2020, "name_normalized": "juwan johnson", "name_suffixless": "juwan johnson"}
        sleeper = {"sleeper_player_id": "7002", "name": "Juwan Johnson", "name_normalized": "juwan johnson", "name_suffixless": "juwan johnson", "position": "TE", "fantasy_positions": "TE", "team": "NO", "birth_date": "1996-09-13", "college": "oregon", "rookie_year": 2020, "height": 76, "weight": 245}
        row = matcher.match_player(kaggle, {"juwan johnson": [sleeper]}, {"juwan johnson": [sleeper]}, {"WR": []})
        self.assertEqual((row["sleeper_player_id"], row["sleeper_position"], row["historical_position"]), ("7002", "TE", "WR"))

    def test_equal_score_duplicate_name_is_not_resolved(self):
        kaggle = {"player_id": "x", "pfr_player_id": "", "player_name": "Sam Test", "historical_position": "WR", "position_group": "WR", "historical_team": "", "birth_date": "", "height": None, "weight": None, "college_name": "", "college": "", "rookie_season": None, "name_normalized": "sam test", "name_suffixless": "sam test"}
        candidates = [{"sleeper_player_id": str(i), "name": "Sam Test", "name_normalized": "sam test", "name_suffixless": "sam test", "position": "WR", "fantasy_positions": "WR", "team": "", "birth_date": "", "college": "", "rookie_year": None, "height": None, "weight": None} for i in ("1", "2")]
        row = matcher.match_player(kaggle, {"sam test": candidates}, {"sam test": candidates}, {"WR": candidates})
        self.assertEqual((row["confidence"], row["sleeper_player_id"]), ("review", ""))


class WeeklyEtlValidationTests(unittest.TestCase):
    def test_required_column_validation(self):
        with self.assertRaisesRegex(ValueError, "missing required columns"):
            etl.validate_required_columns(pd.DataFrame({"player_id": []}), etl.WEEKLY_COLUMNS, "weekly stats")

    def test_weekly_uniqueness_validation(self):
        row = {column: 0 for column in etl.WEEKLY_COLUMNS}
        row.update({"player_id": "00-1", "season": 2024, "week": 1, "season_type": "REG", "game_id": "game", "team": "NE"})
        with self.assertRaisesRegex(ValueError, "duplicate weekly records"):
            etl.validate_weekly_stats(pd.DataFrame([row, row.copy()]))


if __name__ == "__main__":
    unittest.main()
