import pandas as pd

from scripts.build_defense_vs_position import build_lookup, normalize_team


def test_defense_lookup_uses_actual_points_allowed_and_explicit_rank_direction():
    rows = []
    teams = [f"T{index:02d}" for index in range(32)]
    for season in (2024, 2025):
        for week in range(1, 18):
            for index, team in enumerate(teams):
                for position in ("QB", "RB", "WR", "TE"):
                    rows.append({
                        "season": season, "week": week, "season_type": "REG",
                        "game_id": f"{season}-{week}-{team}", "opponent_team": team,
                        "historical_position": position,
                        "fantasy_points_ppr": 10 + index,
                    })
    lookup = build_lookup(pd.DataFrame(rows), 2025)
    rb = lookup["positions"]["RB"]
    assert rb["defenses"]["T00"]["rank"] == 1
    assert rb["defenses"]["T31"]["rank"] == 32
    assert rb["defenses"]["T00"]["adjustment_ppg"] < 0
    assert rb["defenses"]["T31"]["adjustment_ppg"] > 0
    assert abs(rb["defenses"]["T00"]["adjustment_ppg"]) <= rb["soft_cap_ppg"]


def test_rams_team_code_is_canonical_for_application_lookup():
    assert normalize_team("LA") == "LAR"
    assert normalize_team("LAR") == "LAR"
