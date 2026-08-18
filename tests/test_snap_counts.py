import unittest

import pandas as pd

from scripts.build_nflverse_snap_counts import (
    build_shifted_snap_features,
    infer_team_offensive_snaps,
    normalize_snap_counts,
    round_percentage_half_up,
    validate_source,
)


def source_row(**changes):
    row = {
        "game_id": "2025_01_B_A", "pfr_game_id": "pfr", "season": 2025,
        "game_type": "REG", "week": 1, "player": "Runner",
        "pfr_player_id": "RunnEr00", "position": "RB", "team": "A",
        "opponent": "B", "offense_snaps": 40, "offense_pct": 0.63,
        "defense_snaps": 0, "defense_pct": 0.0, "st_snaps": 2, "st_pct": 0.08,
    }
    row.update(changes)
    return row


class SnapCountTests(unittest.TestCase):
    def test_half_up_percentage_and_team_total_parsing(self):
        frame = pd.DataFrame([
            source_row(),
            source_row(player="Quarterback", pfr_player_id="QuarTe00", position="QB", offense_snaps=64, offense_pct=1.0),
        ])
        self.assertEqual(round_percentage_half_up(pd.Series([40 / 64]))[0], 0.63)
        self.assertEqual(infer_team_offensive_snaps(frame), 64)

    def test_validation_rejects_duplicate_player_game_team(self):
        frame = pd.DataFrame([source_row(), source_row()])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate_source(frame, 2025)

    def test_mapping_keeps_unmatched_out_and_canonicalizes_team(self):
        source = pd.DataFrame([
            source_row(team="OAK", opponent="KC", game_id="2025_01_OAK_KC"),
            source_row(player="Unknown", pfr_player_id="UnknOw00", position="WR", team="OAK", opponent="KC", game_id="2025_01_OAK_KC"),
        ])
        identity = pd.DataFrame([{
            "player_id": "gsis-runner", "pfr_player_id": "RunnEr00",
            "player_name": "Runner", "historical_position": "RB",
        }])
        history = pd.DataFrame([{
            "player_id": "gsis-runner", "season": 2025, "week": 1,
            "season_type": "REG", "team": "LV", "historical_position": "RB",
        }])
        output, diagnostics = normalize_snap_counts(source, identity, history, "now")
        self.assertEqual(output["player_id"].tolist(), ["gsis-runner"])
        self.assertEqual(output.iloc[0]["team"], "LV")
        self.assertEqual(diagnostics["source_mapping"]["unmatched_rows"], 1)

    def test_traded_player_different_weeks_remains_unique(self):
        source = pd.DataFrame([
            source_row(),
            source_row(game_id="2025_02_A_C", pfr_game_id="pfr2", week=2, team="C", opponent="A"),
        ])
        identity = pd.DataFrame([{
            "player_id": "gsis-runner", "pfr_player_id": "RunnEr00",
            "player_name": "Runner", "historical_position": "RB",
        }])
        history = pd.DataFrame([
            {"player_id": "gsis-runner", "season": 2025, "week": 1, "season_type": "REG", "team": "A", "historical_position": "RB"},
            {"player_id": "gsis-runner", "season": 2025, "week": 2, "season_type": "REG", "team": "C", "historical_position": "RB"},
        ])
        output, diagnostics = normalize_snap_counts(source, identity, history, "now")
        self.assertEqual(output["team"].tolist(), ["A", "C"])
        self.assertEqual(diagnostics["duplicates"], 0)

    def test_shifted_snap_window_never_uses_prediction_week(self):
        frame = pd.DataFrame([
            {"player_id": "p", "season": 2024, "week": 1, "offensive_snap_pct": 0.2},
            {"player_id": "p", "season": 2024, "week": 2, "offensive_snap_pct": 0.6},
            {"player_id": "p", "season": 2024, "week": 3, "offensive_snap_pct": 1.0},
        ])
        result = build_shifted_snap_features(frame).set_index("week")
        self.assertAlmostEqual(result.loc[3, "snap_pct_last_1"], 0.6)
        self.assertAlmostEqual(result.loc[3, "snap_pct_last_3"], 0.4)
        self.assertAlmostEqual(result.loc[3, "snap_pct_delta_1"], 0.4)


if __name__ == "__main__":
    unittest.main()
