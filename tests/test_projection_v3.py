import unittest

import pandas as pd

from scripts.projection_pipeline import config
from scripts.projection_pipeline.pbp import aggregate_pbp, finalize_player_features
from scripts.projection_pipeline.v3_config import (
    GOAL_LINE_YARDLINE,
    NEUTRAL_SCORE_DIFFERENTIAL,
    V3_FEATURE_COLUMNS_BY_POSITION,
)
from scripts.projection_pipeline.v3_features import (
    build_v3_modeling_dataset,
    validate_v3_dataset,
)
from scripts.projection_pipeline.v3_model import chronological_split, component_ppr, metric_set


def historical_row(player_id="rb", week=1, position="RB", **changes):
    row = {column: 0 for column in config.BOX_SCORE_COLUMNS}
    row.update({
        "player_id": player_id,
        "season": 2024,
        "week": week,
        "season_type": "REG",
        "game_id": f"history_{week}_{player_id}",
        "team": "A",
        "opponent_team": "B",
        "historical_position": position,
        "fantasy_points_ppr": 10 + week,
        "fantasy_points_half_ppr": 9 + week,
        "fantasy_points_standard": 8 + week,
        "rush_attempts": 10 if position == "RB" else 0,
        "true_touches": 12 if position == "RB" else 0,
        "targets": 4 if position in {"RB", "WR", "TE"} else 0,
        "receptions": 2 if position in {"RB", "WR", "TE"} else 0,
    })
    row.update(changes)
    return row


def play(**changes):
    row = {
        "game_id": "2024_01_B_A", "season": 2024, "season_type": "REG", "week": 1,
        "posteam": "A", "defteam": "B", "qtr": 1, "down": 1,
        "yardline_100": 50, "half_seconds_remaining": 800, "score_differential": 0,
        "qb_dropback": 0, "qb_kneel": 0, "qb_spike": 0, "qb_scramble": 0,
        "rush_attempt": 0, "pass_attempt": 0, "complete_pass": 0, "sack": 0,
        "interception": 0, "touchdown": 0, "pass_touchdown": 0,
        "rush_touchdown": 0, "first_down_pass": 0, "yards_gained": 0,
        "air_yards": None, "yards_after_catch": None, "epa": 0.1, "success": 1,
        "cpoe": None, "aborted_play": 0,
    }
    row.update(changes)
    return row


class PbpAggregationTests(unittest.TestCase):
    def test_rush_target_red_zone_goal_line_and_team_shares(self):
        source = pd.DataFrame([
            play(
                play_type="run", rush_attempt=1, rusher_player_id="rb",
                rusher_player_name="Runner", rushing_yards=2, yardline_100=1,
                rush_touchdown=1, touchdown=1, goal_to_go=1,
            ),
            play(
                play_type="pass", qb_dropback=1, pass_attempt=1, complete_pass=1,
                passer_player_id="qb", passer_player_name="Quarterback",
                receiver_player_id="rb", receiver_player_name="Runner",
                receiving_yards=7, passing_yards=7, air_yards=3,
                yards_after_catch=4, yardline_100=8,
            ),
            play(
                play_type="pass", qb_dropback=1, pass_attempt=1,
                passer_player_id="qb", passer_player_name="Quarterback",
                receiver_player_id="wr", receiver_player_name="Receiver",
                air_yards=25, yardline_100=20, score_differential=-10, down=3,
            ),
        ])
        player, team = aggregate_pbp(source)
        history = pd.DataFrame([
            historical_row("rb"), historical_row("qb", position="QB"),
            historical_row("wr", position="WR"),
        ])
        result, report = finalize_player_features(player, history)
        rb = result.loc[result["player_id"].eq("rb")].iloc[0]
        wr = result.loc[result["player_id"].eq("wr")].iloc[0]
        self.assertEqual(rb["pbp_touches"], 2)
        self.assertEqual(rb["goal_line_carries"], 1)
        self.assertEqual(rb["inside_10_targets"], 1)
        self.assertEqual(rb["team_rush_share"], 1)
        self.assertEqual(rb["backfield_rush_share"], 1)
        self.assertEqual(wr["end_zone_targets"], 1)
        self.assertEqual(wr["third_down_targets"], 1)
        self.assertEqual(wr["targets_while_trailing"], 1)
        self.assertEqual(team.iloc[0]["team_offensive_plays"], 3)
        self.assertEqual(report["unmapped_player_weeks"], 0)

    def test_neutral_script_and_two_minute_boundaries_are_centralized(self):
        source = pd.DataFrame([
            play(
                rush_attempt=1, rusher_player_id="rb", rushing_yards=4,
                score_differential=NEUTRAL_SCORE_DIFFERENTIAL,
                half_seconds_remaining=120,
            ),
            play(
                rush_attempt=1, rusher_player_id="rb", rushing_yards=3,
                score_differential=NEUTRAL_SCORE_DIFFERENTIAL + 1,
                half_seconds_remaining=121,
            ),
        ])
        player, _ = aggregate_pbp(source)
        row = player.iloc[0]
        self.assertEqual(row["neutral_script_rushes"], 1)
        self.assertEqual(row["two_minute_rushes"], 1)

    def test_long_touchdown_without_red_zone_usage_does_not_create_goal_line_opportunity(self):
        source = pd.DataFrame([play(
            rush_attempt=1, rusher_player_id="rb", rushing_yards=75,
            yardline_100=75, rush_touchdown=1, touchdown=1,
        )])
        player, _ = aggregate_pbp(source)
        row = player.iloc[0]
        self.assertEqual(row["goal_line_carries"], 0)
        self.assertEqual(row["red_zone_carries"], 0)
        self.assertGreater(row["explosive_rushes"], 0)
        self.assertEqual(GOAL_LINE_YARDLINE, 2)

    def test_unmapped_pbp_identity_is_reported_not_fabricated(self):
        player, _ = aggregate_pbp(pd.DataFrame([
            play(rush_attempt=1, rusher_player_id="unknown", rushing_yards=3)
        ]))
        result, report = finalize_player_features(player, pd.DataFrame([historical_row("rb")]))
        self.assertTrue(result.empty)
        self.assertEqual(report["unmapped_player_weeks"], 1)


class V3FeatureTests(unittest.TestCase):
    def test_advanced_rolling_features_are_shifted_and_do_not_leak_current_week(self):
        historical = pd.DataFrame([
            historical_row(week=1), historical_row(week=2), historical_row(week=3),
        ])
        advanced = pd.DataFrame([
            {"player_id": "rb", "season": 2024, "week": 1, "team": "A", "pbp_touches": 10},
            {"player_id": "rb", "season": 2024, "week": 2, "team": "A", "pbp_touches": 20},
            {"player_id": "rb", "season": 2024, "week": 3, "team": "A", "pbp_touches": 999},
        ])
        result = build_v3_modeling_dataset(historical, advanced).set_index("week")
        self.assertEqual(result.loc[3, "pbp_touches_l3"], 15)
        self.assertEqual(result.loc[3, "pbp_touches_season_avg"], 15)

    def test_v3_feature_lists_are_position_specific_and_identity_free(self):
        self.assertIn("goal_line_carries_l3", V3_FEATURE_COLUMNS_BY_POSITION["RB"])
        self.assertNotIn("goal_line_carries_l3", V3_FEATURE_COLUMNS_BY_POSITION["WR"])
        for features in V3_FEATURE_COLUMNS_BY_POSITION.values():
            self.assertNotIn("player_id", features)
            self.assertNotIn("game_id", features)

    def test_v3_dataset_validation_rejects_duplicate_player_week(self):
        historical = pd.DataFrame([historical_row(), historical_row()])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            build_v3_modeling_dataset(historical, pd.DataFrame(columns=["player_id", "season", "week", "team"]))

    def test_v3_metrics_include_reproducible_r_squared(self):
        metrics = metric_set(pd.Series([1.0, 2.0, 3.0]).to_numpy(), pd.Series([1.0, 2.0, 3.0]).to_numpy())
        self.assertEqual(metrics["r2"], 1.0)
        self.assertEqual(metrics["mae"], 0.0)

    def test_all_rolling_windows_use_only_prior_games_across_season_boundaries(self):
        historical = pd.DataFrame([
            historical_row(week=1, season=2023, game_id="2023_1"),
            historical_row(week=2, season=2023, game_id="2023_2"),
            historical_row(week=1, season=2024, game_id="2024_1"),
        ])
        advanced = pd.DataFrame([
            {"player_id": "rb", "season": 2023, "week": 1, "team": "A", "pbp_touches": 5},
            {"player_id": "rb", "season": 2023, "week": 2, "team": "A", "pbp_touches": 15},
            {"player_id": "rb", "season": 2024, "week": 1, "team": "A", "pbp_touches": 500},
        ])
        row = build_v3_modeling_dataset(historical, advanced).loc[lambda frame: frame.season.eq(2024)].iloc[0]
        self.assertEqual(row["pbp_touches_l3"], 10)
        self.assertEqual(row["pbp_touches_l5"], 10)
        self.assertEqual(row["pbp_touches_l8"], 10)
        self.assertTrue(pd.isna(row["pbp_touches_season_avg"]))

    def test_rookie_without_prior_pbp_history_keeps_missing_pregame_features(self):
        historical = pd.DataFrame([historical_row(player_id="rookie")])
        advanced = pd.DataFrame([
            {"player_id": "rookie", "season": 2024, "week": 1, "team": "A", "pbp_touches": 12}
        ])
        row = build_v3_modeling_dataset(historical, advanced).iloc[0]
        self.assertTrue(pd.isna(row["pbp_touches_l3"]))
        self.assertTrue(pd.isna(row["pbp_touches_season_avg"]))

    def test_chronological_split_is_deterministic_and_future_safe(self):
        frame = pd.DataFrame({"season": [2025, 2018, 2024, 2023], "value": [4, 1, 3, 2]})
        train, validation, test = chronological_split(frame)
        self.assertEqual(sorted(train["season"].tolist()), [2018, 2023])
        self.assertEqual(validation["season"].tolist(), [2024])
        self.assertEqual(test["season"].tolist(), [2025])

    def test_component_ppr_scores_opportunity_targets_without_identity_inputs(self):
        predictions = {
            "rushing_yards": pd.Series([50.0]).to_numpy(),
            "rushing_touchdowns": pd.Series([1.0]).to_numpy(),
            "receptions": pd.Series([4.0]).to_numpy(),
            "receiving_yards": pd.Series([30.0]).to_numpy(),
        }
        self.assertEqual(component_ppr(predictions, 1).tolist(), [18.0])


if __name__ == "__main__":
    unittest.main()
