import unittest

import pandas as pd

from scripts.download_nflverse_players import normalize_draft_capital
from scripts.import_player_draft_capital import build_updates, load_canonical_player_ids


class PlayerDraftCapitalTests(unittest.TestCase):
    def test_normalizes_drafted_udfa_and_unknown_as_distinct_states(self):
        source = pd.DataFrame([
            {"gsis_id": "drafted", "display_name": "Drafted", "pfr_id": "DrafPl00", "position": "RB", "rookie_season": 2026, "draft_year": 2026, "draft_round": 2, "draft_pick": 45, "draft_team": "BUF"},
            {"gsis_id": "udfa", "display_name": "UDFA", "pfr_id": "UdfaPl00", "position": "RB", "rookie_season": 2026, "draft_year": None, "draft_round": None, "draft_pick": None, "draft_team": None},
            {"gsis_id": "unknown", "display_name": "Unknown", "pfr_id": None, "position": "RB", "rookie_season": 2026, "draft_year": None, "draft_round": None, "draft_pick": None, "draft_team": None},
        ])
        result = normalize_draft_capital(source, "2026-08-17T00:00:00Z").set_index("gsis_id")
        self.assertEqual(result.loc["drafted", "draft_status"], "drafted")
        self.assertEqual(result.loc["udfa", "draft_status"], "undrafted")
        self.assertEqual(result.loc["unknown", "draft_status"], "unknown")

    def test_import_updates_canonical_player_ids_without_name_matching(self):
        source = pd.DataFrame([{
            "gsis_id": "00-1", "draft_year": 2026, "draft_round": 4,
            "draft_pick": 120, "draft_team": "BUF", "draft_status": "drafted",
            "provider": "nflverse/players", "fetched_at": "2026-08-17T00:00:00Z",
        }])
        updates = build_updates(source, {"00-1": "canonical-uuid"})
        self.assertEqual(updates[0]["id"], "canonical-uuid")
        self.assertEqual(updates[0]["draft_round"], 4)

    def test_import_preserves_valid_pre_1994_rounds_beyond_seven(self):
        source = pd.DataFrame([{
            "gsis_id": "00-historical", "draft_year": 1993, "draft_round": 8,
            "draft_pick": 216, "draft_team": "PIT", "draft_status": "drafted",
            "provider": "nflverse/players", "fetched_at": "2026-08-17T00:00:00Z",
        }])
        updates = build_updates(source, {"00-historical": "canonical-uuid"})
        self.assertEqual(updates[0]["draft_round"], 8)

    def test_canonical_identity_lookup_is_paginated_not_source_id_batched(self):
        class Client:
            def __init__(self):
                self.paths = []

            def request(self, method, path):
                self.paths.append((method, path))
                if "offset=0" in path:
                    return [
                        {"id": "one", "gsis_id": "00-1"},
                        {"id": "two", "gsis_id": "00-2"},
                    ]
                return [{"id": "three", "gsis_id": "00-3"}]

        client = Client()
        result = load_canonical_player_ids(client, page_size=2)
        self.assertEqual(result, {"00-1": "one", "00-2": "two", "00-3": "three"})
        self.assertEqual(len(client.paths), 2)


if __name__ == "__main__":
    unittest.main()
