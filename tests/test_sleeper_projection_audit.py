import unittest

import pandas as pd

from scripts.audit_sleeper_week1_projections import expected_long_events, normalize_name, resolve_cohort
from scripts.projection_pipeline.scoring import score_projected_stats_exact
from scripts.projection_pipeline.long_play_features import LongPlayRateLookup


class SleeperProjectionAuditTests(unittest.TestCase):
    def test_name_normalization_is_only_for_identity_resolution(self):
        self.assertEqual(normalize_name("Kenneth Walker III"), normalize_name("Kenneth Walker"))
        self.assertEqual(normalize_name("Ja'Marr Chase"), "ja marr chase")

    def test_expected_rare_events_are_rates_times_projected_opportunity(self):
        stats = {"receptions": 5, "receiving_touchdowns": .4, "rush_attempts": 10}
        rates = {f"{event}_rate": 0 for event in (
            "receptions_20_29_yards", "receptions_30_39_yards", "receptions_40_plus_yards",
            "receiving_touchdowns_40_plus_yards", "receiving_touchdowns_50_plus_yards",
            "rushes_40_plus_yards", "rushing_touchdowns_40_plus_yards", "rushing_touchdowns_50_plus_yards",
            "completions_40_plus_yards", "passing_touchdowns_40_plus_yards", "passing_touchdowns_50_plus_yards",
        )}
        rates["receptions_40_plus_yards_rate"] = .02
        rates["rushes_40_plus_yards_rate"] = .01
        result = expected_long_events(stats, rates)
        self.assertAlmostEqual(result["receptions_40_plus_yards"], .1)
        self.assertAlmostEqual(result["rushes_40_plus_yards"], .1)

    def test_custom_scoring_is_a_component_translation_not_a_model_blend(self):
        stats = {
            "rushing_yards": 50, "rush_attempts": 15, "receptions": 3,
            "receiving_yards": 20, "receptions_40_plus_yards": .1,
        }
        base = score_projected_stats_exact(stats, {"rec": 1}, "RB")
        custom = score_projected_stats_exact(stats, {"rec": 1, "rush_att": .1, "rec_40p": .5}, "RB")
        self.assertAlmostEqual(custom - base, 1.55)

    def test_conflicting_rows_for_one_sleeper_id_are_marked_ambiguous(self):
        cohort = pd.DataFrame([
            {"player": "Example Player", "position": "RB", "sleeper_projection": 8.0},
            {"player": "Example Player", "position": "RB", "sleeper_projection": 12.0},
        ])
        identities = pd.DataFrame([{
            "player_id": "00-1", "player_name": "Example Player", "historical_position": "RB",
            "sleeper_player_id": "123", "sleeper_name": "Example Player", "sleeper_position": "RB",
        }])
        resolved, unresolved = resolve_cohort(cohort, identities)
        self.assertEqual(unresolved, [])
        self.assertTrue(resolved.ambiguous_duplicate.all())

    def test_future_long_play_fields_use_player_rate_and_position_fallback(self):
        rates = pd.DataFrame([{
            "player_id": "known", "historical_position": "RB", "rush_attempts": 100,
            "rushes_40_plus_yards": 2, "rushes_40_plus_yards_rate": .015,
            **{name: 0 for name in (
                "receptions", "receptions_20_29_yards", "receptions_30_39_yards", "receptions_40_plus_yards",
                "receiving_touchdowns", "receiving_touchdowns_40_plus_yards", "receiving_touchdowns_50_plus_yards",
                "rushing_touchdowns", "rushing_touchdowns_40_plus_yards", "rushing_touchdowns_50_plus_yards",
                "completions", "completions_40_plus_yards", "passing_touchdowns",
                "passing_touchdowns_40_plus_yards", "passing_touchdowns_50_plus_yards",
            )},
            **{f"{name}_rate": 0 for name in (
                "receptions_20_29_yards", "receptions_30_39_yards", "receptions_40_plus_yards",
                "receiving_touchdowns_40_plus_yards", "receiving_touchdowns_50_plus_yards",
                "rushing_touchdowns_40_plus_yards", "rushing_touchdowns_50_plus_yards",
                "completions_40_plus_yards", "passing_touchdowns_40_plus_yards", "passing_touchdowns_50_plus_yards",
            )},
        }])
        lookup = LongPlayRateLookup(rates)
        self.assertAlmostEqual(lookup.expected({"rush_attempts": 10}, "known", "RB")["rushes_40_plus_yards"], .15)
        self.assertAlmostEqual(lookup.expected({"rush_attempts": 10}, "rookie", "RB")["rushes_40_plus_yards"], .2)


if __name__ == "__main__":
    unittest.main()
