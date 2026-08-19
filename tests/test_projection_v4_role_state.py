import unittest

import pandas as pd

from scripts.projection_pipeline.v4_role_state import (
    merge_role_state, prepare_depth_charts, prepare_injuries, prepare_weekly_rosters,
)


class ProjectionV4RoleStateTests(unittest.TestCase):
    def test_injury_rows_after_cutoff_are_excluded(self):
        injuries = pd.DataFrame([{ "season": 2024, "week": 1, "team": "JAC", "gsis_id": "p1",
            "report_status": "Out", "practice_status": "Did Not Participate In Practice",
            "date_modified": "2024-09-08T12:00:00Z" }])
        schedules = pd.DataFrame([{ "season": 2024, "week": 1, "team": "JAX", "kickoff": "2024-09-08T17:00:00Z" }])
        self.assertTrue(prepare_injuries(injuries, schedules, cutoff_hours=24).empty)


    def test_current_week_roster_handles_trade_without_name_join(self):
        roster = pd.DataFrame([
            {"gsis_id": "p1", "season": 2024, "week": 1, "team": "SEA", "position": "RB", "status": "ACT",
             "years_exp": 2, "rookie_year": 2022, "draft_number": 40},
            {"gsis_id": "p1", "season": 2024, "week": 2, "team": "DEN", "position": "RB", "status": "ACT",
             "years_exp": 2, "rookie_year": 2022, "draft_number": 40},
        ])
        prepared = prepare_weekly_rosters(roster)
        base = pd.DataFrame([
            {"player_id": "p1", "season": 2024, "week": 1, "team": "SEA"},
            {"player_id": "p1", "season": 2024, "week": 2, "team": "DEN"},
        ])
        empty = pd.DataFrame(columns=["player_id", "season", "week", "team"])
        output = merge_role_state(base, prepared, empty, empty)
        self.assertEqual(output.canonical_team.tolist(), ["SEA", "DEN"])
        self.assertEqual(output.team_changed.tolist(), [0, 1])


    def test_depth_missing_is_not_observed_zero(self):
        depth = pd.DataFrame([{ "season": 2024, "week": 1, "club_code": "LAR", "formation": "Offense",
            "gsis_id": "p1", "position": "WR", "depth_team": 1 }])
        prepared = prepare_depth_charts(depth)
        self.assertEqual(prepared.iloc[0].team, "LA")
        self.assertEqual(prepared.iloc[0].starter, 1)


if __name__ == "__main__":
    unittest.main()
