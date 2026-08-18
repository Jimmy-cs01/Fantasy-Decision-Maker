import unittest

import numpy as np
import pandas as pd

from scripts.projection_pipeline.v3_1_model import (
    arbitrate_opportunity,
    bootstrap_mae_difference,
    coherent_components,
    derive_and_normalize_red_zone,
    history_category,
    normalize_team_opportunities,
    role_confidence,
    sample_weight,
    select_ensemble_weight,
)
from scripts.projection_pipeline.v3_model import component_ppr


def role_row(position="RB", depth=1, games=24, starter=True, **changes):
    row = {
        "player_id": changes.pop("player_id", "p"), "season": 2026, "week": 1, "team": "A",
        "historical_position": position, "career_games_before": games,
        "depth_rank": depth, "is_starter": starter,
        "team_offensive_plays_l3": 64, "team_pass_rate_l3": 0.56,
        "pass_attempts_l3": 32 if position == "QB" else np.nan,
        "pbp_pass_attempts_l3": 32 if position == "QB" else np.nan,
        "rush_attempts_l3": 13 if position == "RB" else 0,
        "pbp_rush_attempts_l3": 13 if position == "RB" else 0,
        "true_touches_l3": 16 if position == "RB" else 0,
        "pbp_touches_l3": 16 if position == "RB" else 0,
        "targets_l3": 8 if position in {"WR", "TE"} else (3 if position == "RB" else 0),
        "pbp_targets_l3": 8 if position in {"WR", "TE"} else (3 if position == "RB" else 0),
    }
    row.update(changes)
    return pd.Series(row)


class RoleArbitrationTests(unittest.TestCase):
    def test_stable_rb1_has_high_role_confidence(self):
        self.assertGreater(role_confidence(role_row(), "RB"), 0.8)

    def test_rb2_committee_retains_meaningful_confidence(self):
        self.assertGreater(role_confidence(role_row(depth=2, starter=False, true_touches_l3=13, pbp_touches_l3=13), "RB"), 0.55)

    def test_rb4_without_history_receives_low_opportunity(self):
        row = role_row(depth=4, games=0, starter=False, true_touches_l3=np.nan, pbp_touches_l3=np.nan, rush_attempts_l3=np.nan, pbp_rush_attempts_l3=np.nan)
        self.assertLess(arbitrate_opportunity(15, row, "RB", "rush_attempts"), 3)

    def test_qb1_and_qb2_roles_diverge(self):
        starter = role_confidence(role_row("QB", depth=1), "QB")
        backup = role_confidence(role_row("QB", depth=2, starter=False, pass_attempts_l3=0, pbp_pass_attempts_l3=0), "QB")
        self.assertGreater(starter, 0.8)
        self.assertLess(backup, 0.25)

    def test_strong_usage_can_override_stale_depth(self):
        stale = role_row(depth=3, starter=False, true_touches_l3=18, pbp_touches_l3=18)
        self.assertGreaterEqual(role_confidence(stale, "RB"), 0.68)

    def test_established_sample_is_not_shrunk_like_rookie(self):
        veteran = sample_weight(role_row(games=40), "RB")
        rookie = sample_weight(role_row(games=0, true_touches_l3=np.nan, pbp_touches_l3=np.nan), "RB")
        self.assertGreater(veteran, rookie)
        self.assertEqual(history_category(role_row(games=0)), "zero_games")
        self.assertEqual(history_category(role_row(games=20)), "17_plus_games")

    def test_draft_capital_only_modifies_low_sample_role_prior(self):
        first_round = role_row(depth=2, games=0, starter=False, draft_round=1, draft_status="drafted")
        undrafted = role_row(depth=2, games=0, starter=False, draft_round=np.nan, draft_status="undrafted")
        self.assertGreater(role_confidence(first_round, "RB"), role_confidence(undrafted, "RB"))
        veteran_one = role_row(depth=2, games=30, starter=False, draft_round=1, draft_status="drafted")
        veteran_udfa = role_row(depth=2, games=30, starter=False, draft_round=np.nan, draft_status="undrafted")
        self.assertEqual(role_confidence(veteran_one, "RB"), role_confidence(veteran_udfa, "RB"))


class OpportunityCoherenceTests(unittest.TestCase):
    def test_team_targets_and_backfield_carries_reconcile(self):
        frame = pd.DataFrame([
            role_row("RB", player_id="rb1").to_dict(),
            role_row("RB", depth=4, games=0, starter=False, player_id="rb4", true_touches_l3=np.nan, pbp_touches_l3=np.nan).to_dict(),
            role_row("WR", player_id="wr1").to_dict(),
            role_row("TE", player_id="te1").to_dict(),
            role_row("QB", player_id="qb1").to_dict(),
        ])
        predictions = [
            {"rush_attempts": 22, "targets": 8}, {"rush_attempts": 16, "targets": 7},
            {"targets": 18, "rush_attempts": 0}, {"targets": 14, "rush_attempts": 0},
            {"pass_attempts": 55, "rush_attempts": 4},
        ]
        normalized, audit = normalize_team_opportunities(frame, predictions)
        normalized, audit = derive_and_normalize_red_zone(frame, normalized, audit)
        row = audit.iloc[0]
        self.assertLessEqual(row.targets_after, row.target_budget)
        self.assertLessEqual(row.rb_carries_after, row.rb_carry_budget)
        self.assertLessEqual(row.pass_attempts_after, row.pass_attempt_budget)
        self.assertLessEqual(row.red_zone_carries_after, row.red_zone_carries_budget)
        self.assertLessEqual(row.red_zone_targets_after, row.red_zone_targets_budget)
        self.assertGreater(normalized[0]["rush_attempts"], normalized[1]["rush_attempts"])

    def test_low_carries_cannot_create_large_rushing_yards(self):
        frame = pd.DataFrame([role_row(
            depth=4, games=0, starter=False, true_touches_l3=np.nan,
            pbp_touches_l3=np.nan, rush_attempts_l3=np.nan,
            pbp_rush_attempts_l3=np.nan,
        ).to_dict()])
        raw = [{"fantasy_points_ppr": 20, "rush_attempts": 1, "rushing_yards": 100, "rushing_touchdowns": 1, "targets": 0, "receptions": 0, "receiving_yards": 0, "receiving_touchdowns": 0}]
        coherent, _ = coherent_components(frame, raw)
        self.assertLess(coherent[0]["rushing_yards"], 12)

    def test_tiny_touchdown_conversion_sample_regresses(self):
        frame = pd.DataFrame([role_row(
            games=2, true_touches_l3=2, pbp_touches_l3=2,
            rush_attempts_l3=2, pbp_rush_attempts_l3=2,
        ).to_dict()])
        raw = [{"fantasy_points_ppr": 10, "rush_attempts": 2, "rushing_yards": 8, "rushing_touchdowns": 2, "targets": 0, "receptions": 0, "receiving_yards": 0, "receiving_touchdowns": 0}]
        coherent, _ = coherent_components(frame, raw)
        conversion = coherent[0]["rushing_touchdowns"] / coherent[0]["rush_attempts"]
        self.assertLess(conversion, 0.10)

    def test_component_fantasy_score_is_exactly_derived(self):
        components = {"rushing_yards": np.array([50.0]), "rushing_touchdowns": np.array([1.0]), "receptions": np.array([4.0]), "receiving_yards": np.array([30.0])}
        self.assertEqual(component_ppr(components, 1)[0], 18.0)


class SelectionSafetyTests(unittest.TestCase):
    def test_ensemble_weight_selection_is_deterministic(self):
        actual = np.array([5.0, 10.0, 15.0])
        v2 = np.array([4.0, 9.0, 14.0])
        candidate = actual.copy()
        self.assertEqual(select_ensemble_weight(actual, v2, candidate), 1.0)
        self.assertEqual(select_ensemble_weight(actual, v2, candidate), 1.0)

    def test_bootstrap_interval_is_reproducible(self):
        actual = np.arange(1.0, 21.0)
        baseline = actual + 1
        candidate = actual + 0.5
        first = bootstrap_mae_difference(actual, baseline, candidate)
        second = bootstrap_mae_difference(actual, baseline, candidate)
        self.assertEqual(first, second)
        self.assertLess(first["upper_95"], 0)


if __name__ == "__main__":
    unittest.main()
