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
