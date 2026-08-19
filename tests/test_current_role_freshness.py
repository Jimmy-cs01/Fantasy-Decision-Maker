import unittest

import pandas as pd

from scripts.audit_current_role_freshness import build_audit, current_depth_rows, normalize_team


class CurrentRoleFreshnessTests(unittest.TestCase):
    def test_team_aliases_do_not_create_false_conflicts(self):
        self.assertEqual(normalize_team("LAR"), "LA")
    def test_latest_depth_source_wins_deterministically(self):
        rows = pd.DataFrame([
            {"gsis_id": "p", "season": 2026, "team": "OLD", "source_updated_at": "2026-01-01", "fetched_at": "2026-01-02"},
            {"gsis_id": "p", "season": 2026, "team": "NEW", "source_updated_at": "2026-02-01", "fetched_at": "2026-02-02"},
        ])
        self.assertEqual(current_depth_rows(rows).iloc[0].team, "NEW")

    def test_conflicting_team_sources_are_flagged(self):
        projections = pd.DataFrame([{"gsis_id": "p", "player_name": "P", "team": "A", "depth_position": "RB", "depth_rank": 1, "is_starter": True}])
        identities = pd.DataFrame([{"player_id": "p", "sleeper_player_id": "s", "sleeper_current_team": "B"}])
        depth = pd.DataFrame([{"gsis_id": "p", "season": 2026, "team": "A", "depth_position": "RB", "depth_rank": 1, "is_starter": True, "provider": "x", "source_updated_at": "2026-02-01", "fetched_at": "2026-02-02"}])
        sleeper = {"s": {"player": {"team": "B"}}}
        result = build_audit(projections, identities, depth, sleeper)
        self.assertTrue(bool(result.iloc[0].team_conflict))


if __name__ == "__main__":
    unittest.main()
