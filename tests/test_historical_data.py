import unittest
import tempfile
from pathlib import Path
from unittest import mock

import pandas as pd

from scripts import build_historical_weekly_stats as etl
from scripts import import_historical_data as importer
from scripts import match_sleeper_players as matcher
from scripts import download_nflverse_player_stats as downloader


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
    @staticmethod
    def source_row(**changes):
        row = {column: 0 for column in etl.SOURCE_COLUMNS}
        row.update({"player_id": "00-1", "player_display_name": "Player One", "position": "RB", "position_group": "RB", "headshot_url": "", "season": 2024, "week": 1, "season_type": "REG", "team": "A", "opponent_team": "B", "fantasy_points": 10.0, "fantasy_points_ppr": 12.0, "receptions": 2})
        row.update(changes)
        return row

    def test_all_expected_nflverse_files_have_the_canonical_source_schema(self):
        paths = etl.source_files()
        self.assertEqual([int(path.stem[-4:]) for path in paths], list(range(2012, 2026)))
        for path in paths:
            header = pd.read_csv(path, nrows=0)
            etl.validate_required_columns(header, sorted(etl.REQUIRED_SOURCE_COLUMNS), str(path))

    def test_downloader_rejects_structurally_invalid_source_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stats_player_week_1999.csv"
            pd.DataFrame({"season": [1999], "week": [1]}).to_csv(path, index=False)
            with mock.patch.object(downloader, "MIN_FILE_BYTES", 1):
                with self.assertRaisesRegex(ValueError, "missing required columns"):
                    downloader.validate_source_file(path, 1999)

    def test_required_column_validation(self):
        with self.assertRaisesRegex(ValueError, "missing required columns"):
            etl.validate_required_columns(pd.DataFrame({"player_id": []}), etl.WEEKLY_COLUMNS, "weekly stats")

    def test_weekly_uniqueness_validation(self):
        row = etl.normalize_weekly(pd.DataFrame([self.source_row()])).iloc[0].to_dict()
        with self.assertRaisesRegex(ValueError, "duplicate weekly records"):
            etl.validate_weekly_stats(pd.DataFrame([row, row.copy()]))

    def test_nflverse_normalization_preserves_gsis_scoring_and_source(self):
        row = self.source_row(carries=10, rushing_yards=55, rushing_tds=1, receptions=4, targets=5, receiving_yards=30, receiving_tds=1, fantasy_points=14.5, fantasy_points_ppr=18.5)
        result = etl.normalize_weekly(pd.DataFrame([row])).iloc[0]
        self.assertEqual(result["player_id"], "00-1")
        self.assertEqual(result["source"], "nflverse")
        self.assertEqual(result["fantasy_points_half_ppr"], 16.5)
        self.assertEqual(result["yards_per_carry"], 5.5)
        self.assertEqual(result["true_touches"], 14)
        self.assertEqual(result["total_touchdowns"], 2)

    def test_unavailable_advanced_metric_remains_null(self):
        result = etl.normalize_weekly(pd.DataFrame([self.source_row(passing_epa=pd.NA, passing_cpoe=pd.NA)])).iloc[0]
        self.assertTrue(pd.isna(result["passing_epa"]))
        self.assertTrue(pd.isna(result["passing_cpoe"]))

    def test_old_player_without_sleeper_mapping_remains_importable(self):
        source = pd.DataFrame([self.source_row(player_id="00-OLD-TEST", player_display_name="Historical Player", season=1999)])
        identity, additions = etl.build_identity(source)
        row = identity[identity["player_id"] == "00-OLD-TEST"].iloc[0]
        self.assertEqual(additions, 1)
        self.assertEqual(row["sleeper_player_id"], "")

    def test_safe_division_and_team_specific_logical_identity(self):
        source = pd.DataFrame([self.source_row(attempts=0), self.source_row(team="C", opponent_team="D", attempts=10, passing_yards=75)])
        result = etl.normalize_weekly(source)
        self.assertTrue(pd.isna(result.iloc[0]["yards_per_attempt"]))
        self.assertEqual(result.iloc[1]["yards_per_attempt"], 7.5)
        self.assertNotEqual(result.iloc[0]["game_id"], result.iloc[1]["game_id"])

    def test_reg_and_post_rows_remain_independent(self):
        source = pd.DataFrame([self.source_row(season_type="REG"), self.source_row(season_type="POST", week=20)])
        result = etl.normalize_weekly(source)
        self.assertEqual(set(result["season_type"]), {"REG", "POST"})
        self.assertEqual(etl.validate_weekly_stats(result), 0)

    def test_derrick_henry_2024_reg_nflverse_totals(self):
        columns = ["player_id", "season_type", "carries", "rushing_yards", "rushing_tds", "receptions", "receiving_yards", "receiving_tds"]
        frame = pd.read_csv("data/nflverse/stats_player_week_2024.csv", usecols=columns, dtype={"player_id": "string"})
        henry = frame[(frame["player_id"] == "00-0032764") & (frame["season_type"] == "REG")]
        totals = henry[["carries", "rushing_yards", "rushing_tds", "receptions", "receiving_yards", "receiving_tds"]].sum()
        self.assertEqual(tuple(totals), (325, 1921, 16, 19, 193, 2))


class HistoricalImporterTests(unittest.TestCase):
    def test_supabase_request_retries_a_connection_reset(self):
        client = importer.SupabaseRest("https://example.supabase.co", "service-key")
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b""
        with mock.patch.object(
            importer.urllib.request,
            "urlopen",
            side_effect=[ConnectionResetError(54, "Connection reset by peer"), response],
        ) as urlopen, mock.patch.object(importer.time, "sleep") as sleep:
            self.assertIsNone(client.request("POST", "/players", []))
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_importer_rejects_a_processed_range_before_2012(self):
        identities = pd.DataFrame([
            {"player_id": "00-1", "player_name": "Player One", "historical_position": "RB", "sleeper_player_id": ""}
        ])
        weekly = pd.DataFrame([
            {
                "player_id": "00-1", "season": 2011, "week": 1, "season_type": "REG",
                "game_id": "nflverse:2011:REG:01:A:B", "team": "A", "historical_position": "RB",
                "source": "nflverse", "source_dataset": "player_stats", "source_season": 2011,
                "fantasy_points_standard": 1, "fantasy_points_half_ppr": 1, "fantasy_points_ppr": 1,
            }
        ])
        with tempfile.TemporaryDirectory() as directory:
            identity_path = Path(directory) / "identity.csv"
            weekly_path = Path(directory) / "weekly.csv"
            identities.to_csv(identity_path, index=False)
            weekly.to_csv(weekly_path, index=False)
            with mock.patch.object(importer, "IDENTITY_FILE", identity_path), mock.patch.object(importer, "WEEKLY_FILE", weekly_path):
                with self.assertRaisesRegex(ValueError, "must begin at 2012"):
                    importer.load_and_validate_inputs()

    def test_player_upsert_reuses_existing_sleeper_identity(self):
        identities = pd.DataFrame([{"player_id": "00-1", "player_name": "Player One", "historical_position": "WR", "sleeper_player_id": "7564", "sleeper_position": "WR", "sleeper_fantasy_positions": "WR", "historical_team": "OLD", "height": "72.0", "weight": "200.0"}])
        existing = [{"id": "existing-uuid", "gsis_id": None, "sleeper_player_id": "7564"}]
        payloads, inserted, updated = importer.plan_player_upserts(identities, existing)
        self.assertEqual((payloads[0]["id"], inserted, updated), ("existing-uuid", 0, 1))
        self.assertEqual(payloads[0]["sleeper_player_id"], "7564")
        self.assertEqual((payloads[0]["height"], payloads[0]["weight"]), (72, 200))

    def test_player_upsert_uses_trusted_incoming_headshot(self):
        identities = pd.DataFrame([{"player_id": "00-1", "player_name": "Player One", "historical_position": "WR", "sleeper_player_id": "", "headshot_url": "https://static.www.nfl.com/image/upload/league/new"}])
        payloads, _, _ = importer.plan_player_upserts(identities, [])
        self.assertEqual(payloads[0]["headshot_url"], "https://static.www.nfl.com/image/upload/league/new")

    def test_null_incoming_headshot_preserves_existing_value(self):
        identities = pd.DataFrame([{"player_id": "00-1", "player_name": "Player One", "historical_position": "WR", "sleeper_player_id": "", "headshot_url": ""}])
        existing = [{"id": "existing-uuid", "gsis_id": "00-1", "sleeper_player_id": None, "headshot_url": "https://static.www.nfl.com/image/upload/league/existing"}]
        payloads, _, _ = importer.plan_player_upserts(identities, existing)
        self.assertEqual(payloads[0]["headshot_url"], existing[0]["headshot_url"])

    def test_weekly_payload_uses_internal_uuid_and_nflverse_metadata(self):
        weekly = pd.DataFrame([{"player_id": "00-1", "sleeper_player_id": "7564", "season": 2024, "week": 1, "season_type": "REG", "game_id": "nflverse:2024:REG:01:A:B", "team": "A", "opponent_team": "B", "historical_position": "QB", "source": "nflverse", "source_dataset": "player_stats", "source_season": 2024, "completions": 20, "passing_touchdowns": 2, "interceptions_thrown": 1, "rushing_touchdowns": 1, "receiving_touchdowns": 0, "fantasy_points_standard": 10.0, "fantasy_points_half_ppr": 12.0, "fantasy_points_ppr": 14.0}])
        payload = importer.prepare_weekly_payloads(weekly, {"00-1": "internal-uuid"})[0]
        self.assertEqual(payload["player_id"], "internal-uuid")
        self.assertEqual(payload["completions"], 20)
        self.assertEqual(payload["fantasy_points_ppr"], 14.0)
        self.assertEqual(payload["provider"], "nflverse")
        self.assertEqual(payload["source_dataset"], "player_stats")
        self.assertEqual((payload["passing_touchdowns"], payload["rushing_touchdowns"], payload["receiving_touchdowns"]), (2, 1, 0))

    def test_replacement_delete_is_scoped_to_weekly_stats_and_expected_seasons(self):
        client = object.__new__(importer.SupabaseRest)
        calls = []
        client.request = lambda method, path, body=None, extra_headers=None: calls.append((method, path, body, extra_headers))
        partitions = client.delete_historical_weekly_stats(2024, 2025)
        self.assertEqual((partitions, len(calls)), (4, 4))
        self.assertTrue(all(call[0] == "DELETE" for call in calls))
        self.assertTrue(all(call[1].startswith("/player_weekly_nfl_statistics?") for call in calls))
        self.assertTrue(all("provider=eq.nflverse" in call[1] for call in calls))
        self.assertEqual(
            {(season, season_type) for season in (2024, 2025) for season_type in ("REG", "POST")},
            {
                (int(next(part.split(".", 1)[1] for part in path.split("?", 1)[1].split("&") if part.startswith("season="))),
                 next(part.split(".", 1)[1] for part in path.split("?", 1)[1].split("&") if part.startswith("season_type=")))
                for _, path, _, _ in calls
            },
        )

    def test_normal_payload_generation_is_deterministic(self):
        weekly = pd.DataFrame([{"player_id": "00-1", "season": 2024, "week": 1, "season_type": "REG", "game_id": "nflverse:2024:REG:01:A:B", "team": "A", "opponent_team": "B", "historical_position": "RB", "source": "nflverse", "source_dataset": "player_stats", "source_season": 2024, "fantasy_points_standard": 10.0, "fantasy_points_half_ppr": 11.0, "fantasy_points_ppr": 12.0}])
        first = importer.prepare_weekly_payloads(weekly, {"00-1": "internal-uuid"})
        second = importer.prepare_weekly_payloads(weekly, {"00-1": "internal-uuid"})
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
