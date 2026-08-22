import json

import pandas as pd

from scripts.build_season_projection_horizon import build_horizon


def test_build_horizon_emits_seventeen_weeks_byes_and_no_future_market_evidence():
    base = pd.DataFrame([{
        "gsis_id": "00-1",
        "season": 2026,
        "week": 1,
        "season_type": "REG",
        "team": "A",
        "opponent_team": "B",
        "projected_stats": json.dumps({"rush_attempts": 10, "rushing_yards": 50}),
        "model_projection_ppr": 10.0,
        "projected_points_standard": 8.0,
        "projected_points_half_ppr": 9.0,
        "projected_points_ppr": 10.0,
        "floor_ppr": 5.0,
        "median_ppr": 10.0,
        "ceiling_ppr": 16.0,
        "residual_low": -5.0,
        "residual_high": 6.0,
        "confidence": "high",
        "drivers": json.dumps(["Current role"]),
        "model_version": "v4.1",
        "vegas_projection_ppr": 12.0,
        "sleeper_projection_ppr": 11.0,
        "final_projection_ppr": 11.5,
    }])
    schedule = pd.DataFrame([
        {"season": 2026, "season_type": "REG", "week": week, "team": "A", "opponent_team": "B"}
        for week in range(1, 18) if week != 5
    ])

    result = build_horizon(base, schedule, 2026)

    assert len(result) == 17
    assert not result.duplicated(["gsis_id", "season", "week", "season_type"]).any()
    bye = result.loc[result.week.eq(5)].iloc[0]
    assert bye.is_bye
    assert bye.projected_points_ppr == 0
    assert json.loads(bye.projected_stats)["rush_attempts"] == 0
    future = result.loc[result.week.eq(2)].iloc[0]
    assert pd.isna(future.vegas_projection_ppr)
    assert pd.isna(future.sleeper_projection_ppr)
    assert pd.isna(future.final_projection_ppr)


def test_horizon_uses_bounded_relative_opponent_adjustments():
    base = pd.DataFrame([{
        "gsis_id": "00-1", "player_name": "Runner", "position": "RB",
        "season": 2026, "week": 1, "season_type": "REG", "team": "PHI", "opponent_team": "DAL",
        "projected_stats": json.dumps({"rush_attempts": 18, "rushing_yards": 70, "rushing_touchdowns": .5, "targets": 4, "receptions": 3, "receiving_yards": 25}),
        "model_projection_ppr": 16.5, "projected_points_standard": 13.5,
        "projected_points_half_ppr": 15.0, "projected_points_ppr": 16.5,
        "floor_ppr": 12.5, "median_ppr": 16.5, "ceiling_ppr": 22,
        "residual_low": -4, "residual_high": 5.5, "confidence": "high",
        "drivers": json.dumps(["Current role"]), "model_version": "v4.1",
    }])
    schedule = pd.DataFrame([
        {"season": 2026, "season_type": "REG", "week": 1, "team": "PHI", "opponent_team": "DAL"},
        {"season": 2026, "season_type": "REG", "week": 2, "team": "PHI", "opponent_team": "DEN"},
        {"season": 2026, "season_type": "REG", "week": 3, "team": "PHI", "opponent_team": "CIN"},
    ])
    result = build_horizon(base, schedule, 2026)
    current = result.loc[result.week.eq(1)].iloc[0]
    hard = result.loc[result.week.eq(2)].iloc[0]
    easy = result.loc[result.week.eq(3)].iloc[0]
    assert current.opponent_adjustment_ppg == 0
    assert -.8 <= hard.opponent_adjustment_ppg < 0
    assert 0 < easy.opponent_adjustment_ppg <= .8
    assert hard.projected_points_ppr < current.projected_points_ppr < easy.projected_points_ppr
