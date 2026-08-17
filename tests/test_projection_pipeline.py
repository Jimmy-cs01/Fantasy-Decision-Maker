import json
import tempfile
import unittest
import os
from pathlib import Path
from unittest import mock

import pandas as pd

from scripts import import_player_projections as projection_importer
from scripts.generate_weekly_projections import resolve_schedule
from scripts.import_player_projections import build_rows
from scripts.projection_pipeline import config
from scripts.projection_pipeline.features import (
    build_inference_dataset,
    build_modeling_dataset,
    validate_historical_rows,
)
from scripts.projection_pipeline.model import metric_set, predict_targets
from scripts.projection_pipeline.scoring import score_projected_stats
from scripts.projection_pipeline.scoring import reconcile_stat_line
from scripts.projection_pipeline.schedules import normalize_schedules


def source_row(player_id="p1", week=1, opponent="B", **changes):
    row = {column: 0 for column in config.BOX_SCORE_COLUMNS}
    row.update({
        "player_id": player_id, "season": 2022, "week": week, "season_type": "REG",
        "game_id": f"2022_{week}_{player_id}", "team": "A", "opponent_team": opponent,
        "historical_position": "RB", "rush_attempts": 10 + week,
        "rushing_yards": 50 + week, "targets": 4, "receptions": 3,
        "receiving_yards": 25, "true_touches": 13 + week,
        "fantasy_points_standard": 8 + week, "fantasy_points_half_ppr": 9.5 + week,
        "fantasy_points_ppr": 11 + week,
    })
    row.update(changes)
    return row


class ProjectionFeatureTests(unittest.TestCase):
    def test_current_and_future_results_do_not_leak_into_pregame_features(self):
        original = pd.DataFrame([source_row(week=1), source_row(week=2), source_row(week=3)])
        changed = original.copy()
        changed.loc[changed.week.eq(3), ["fantasy_points_ppr", "rush_attempts"]] = [1000, 500]
        before = build_modeling_dataset(original).set_index("week")
        after = build_modeling_dataset(changed).set_index("week")
        self.assertEqual(before.loc[3, "fantasy_points_ppr_l3"], after.loc[3, "fantasy_points_ppr_l3"])
        self.assertEqual(before.loc[3, "rush_attempts_season_avg"], after.loc[3, "rush_attempts_season_avg"])

    def test_opponent_features_are_pregame_only(self):
        rows = [source_row("p1", 1), source_row("p2", 1), source_row("p1", 2), source_row("p2", 2)]
        result = build_modeling_dataset(pd.DataFrame(rows))
        self.assertTrue(result.loc[result.week.eq(1), "opp_fantasy_points_allowed_season"].isna().all())
        self.assertTrue(result.loc[result.week.eq(2), "opp_fantasy_points_allowed_season"].notna().all())

    def test_required_identity_and_duplicate_validation(self):
        frame = pd.DataFrame([source_row(), source_row()])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate_historical_rows(frame)

    def test_inference_uses_prior_games_and_handles_missing_schedule(self):
        result = build_inference_dataset(pd.DataFrame([source_row(week=1), source_row(week=2)]), 2023, 1)
        self.assertEqual(len(result), 1)
        self.assertTrue(pd.isna(result.iloc[0].opponent_team))
        self.assertEqual(result.iloc[0].fantasy_points_ppr_l3, 12.5)

    def test_week_one_prior_uses_only_the_previous_season(self):
        rows = [
            source_row(week=1, fantasy_points_ppr=10),
            source_row(week=2, fantasy_points_ppr=20),
            source_row(week=1, season=2023, game_id="2023_1_p1", fantasy_points_ppr=999),
        ]
        result = build_modeling_dataset(pd.DataFrame(rows))
        week_one = result[(result.season == 2023) & (result.week == 1)].iloc[0]
        self.assertEqual(week_one.prior_season_games, 2)
        self.assertEqual(week_one.prior_season_ppr_ppg, 15)

    def test_schedule_join_assigns_opponent_home_rest_and_shifted_defense(self):
        games = pd.DataFrame([{
            "game_id": "2022_01_B_A", "season": 2022, "game_type": "REG", "week": 1,
            "gameday": "2022-09-11", "weekday": "Sunday", "away_team": "B",
            "home_team": "A", "location": "Home", "away_rest": 7, "home_rest": 7,
        }, {
            "game_id": "2022_02_A_B", "season": 2022, "game_type": "REG", "week": 2,
            "gameday": "2022-09-15", "weekday": "Thursday", "away_team": "A",
            "home_team": "B", "location": "Home", "away_rest": 4, "home_rest": 4,
        }])
        schedule = normalize_schedules(games, 2022)
        bye_game = pd.DataFrame([{
            "game_id": "2022_03_B_A", "season": 2022, "game_type": "REG", "week": 3,
            "gameday": "2022-09-29", "weekday": "Thursday", "away_team": "B",
            "home_team": "A", "location": "Home", "away_rest": 14, "home_rest": 14,
        }])
        bye_schedule = normalize_schedules(bye_game, 2022)
        self.assertEqual(bye_schedule.iloc[0].returning_from_bye, 1)
        self.assertEqual(bye_schedule.iloc[0].long_rest, 1)
        result = build_modeling_dataset(
            pd.DataFrame([source_row(week=1), source_row(week=2, opponent="B")]),
            schedule,
        ).set_index("week")
        self.assertEqual(result.loc[1, "opponent_team"], "B")
        self.assertEqual(result.loc[1, "is_home"], 1)
        self.assertEqual(result.loc[2, "is_home"], 0)
        self.assertEqual(result.loc[2, "days_rest"], 4)
        self.assertEqual(result.loc[2, "short_week"], 1)
        self.assertEqual(result.loc[2, "is_thursday"], 1)
        self.assertTrue(pd.isna(result.loc[1, "opp_fantasy_points_allowed_l4"]))
        self.assertFalse(pd.isna(result.loc[2, "opp_fantasy_points_allowed_l4"]))

    def test_manual_player_schedule_override_still_works(self):
        schedule = pd.DataFrame([{"player_id": "p1", "opponent_team": "C"}])
        result = build_inference_dataset(pd.DataFrame([source_row()]), 2023, 1, schedule)
        self.assertEqual(result.iloc[0].opponent_team, "C")

    def test_projection_schedule_auto_load_and_cli_override(self):
        with tempfile.TemporaryDirectory() as directory:
            normalized_path = Path(directory) / "schedules.csv"
            pd.DataFrame([{
                "season": 2026, "week": 1, "season_type": "REG", "team": "A",
                "opponent_team": "B", "is_home": 1,
            }]).to_csv(normalized_path, index=False)
            loaded = resolve_schedule(None, True, normalized_path)
            self.assertEqual(loaded.iloc[0].opponent_team, "B")
            override_path = Path(directory) / "override.csv"
            pd.DataFrame([{"player_id": "p1", "opponent_team": "C"}]).to_csv(override_path, index=False)
            override = resolve_schedule(override_path, True, normalized_path)
            self.assertEqual(override.iloc[0].opponent_team, "C")


class ProjectionScoringAndPersistenceTests(unittest.TestCase):
    def test_projection_importer_loads_local_environment_without_overwriting_shell(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env.local"
            env_file.write_text("NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=test-key\n")
            with mock.patch.object(projection_importer, "ENV_FILES", (env_file,)), mock.patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": "shell-key"}, clear=True):
                projection_importer.load_local_environment()
                self.assertEqual(os.environ["NEXT_PUBLIC_SUPABASE_URL"], "https://example.supabase.co")
                self.assertEqual(os.environ["SUPABASE_SERVICE_ROLE_KEY"], "shell-key")

    def test_model_inference_uses_canonical_features_and_clamps_negative_counts(self):
        class FakeModel:
            def predict(self, frame):
                self.columns = list(frame.columns)
                return pd.Series([-2.0, 3.0]).to_numpy()

        frame = pd.DataFrame([{column: 0 for column in config.FEATURE_COLUMNS} for _ in range(2)])
        model = FakeModel()
        result = predict_targets({"targets": model}, frame)
        self.assertEqual(result["targets"].tolist(), [0.0, 3.0])
        self.assertEqual(model.columns, config.FEATURE_COLUMNS)

    def test_custom_sleeper_scoring_scores_projected_stats(self):
        stats = {"passing_yards": 250, "passing_touchdowns": 2, "interceptions_thrown": 1}
        self.assertEqual(score_projected_stats(stats, {"pass_yd": 0.05, "pass_td": 6, "pass_int": -1}), 23.5)

    def test_component_projection_is_reconciled_to_direct_ppr_without_negative_stats(self):
        stats, factor = reconcile_stat_line(
            {"rush_attempts": 20, "rushing_yards": 100, "rushing_touchdowns": 2, "receptions": 4},
            13,
            "RB",
        )
        self.assertLess(factor, 1)
        self.assertAlmostEqual(score_projected_stats(stats, {"rec": 1}, "RB"), 13, places=1)
        self.assertTrue(all(value >= 0 for value in stats.values()))

    def test_player_join_uses_canonical_gsis_identity_and_keeps_json(self):
        frame = pd.DataFrame([{
            "gsis_id": "00-1", "season": 2026, "week": 1, "season_type": "REG",
            "team": "A", "opponent_team": None, "projected_stats": json.dumps({"targets": 7.2}),
            "model_projection_ppr": 14, "projected_points_standard": 10,
            "projected_points_half_ppr": 12, "projected_points_ppr": 14,
            "floor_ppr": 8, "median_ppr": 14, "ceiling_ppr": 22,
            "residual_low": -6, "residual_high": 8, "confidence": "medium",
            "drivers": json.dumps(["Recent volume"]),
        }])
        rows = build_rows(frame, {"00-1": "uuid-1"}, "model-1")
        self.assertEqual(rows[0]["player_id"], "uuid-1")
        self.assertEqual(rows[0]["projected_stats"], {"targets": 7.2})
        with self.assertRaisesRegex(ValueError, "No database player"):
            build_rows(frame, {}, "model-1")

    def test_metric_calculation_supports_model_inference_results(self):
        metrics = metric_set(pd.Series([10.0, 20.0]).to_numpy(), pd.Series([12.0, 18.0]).to_numpy())
        self.assertEqual(metrics["mae"], 2.0)
        self.assertEqual(metrics["rmse"], 2.0)


if __name__ == "__main__":
    unittest.main()
