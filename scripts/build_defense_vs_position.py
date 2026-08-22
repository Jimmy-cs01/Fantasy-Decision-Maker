#!/usr/bin/env python3
"""Build a conservative prior-season defense-vs-position lookup.

The metric is team fantasy points allowed per game under neutral PPR scoring.
It is shrunk toward the league mean before being normalized so one noisy season
cannot dominate a weekly player projection.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data/processed/historical_weekly_player_stats.csv"
DEFAULT_OUTPUT = ROOT / "lib/projections/defense-vs-position-2025.json"
POSITIONS = ("QB", "RB", "WR", "TE")
POSITION_CAPS = {"QB": 0.65, "RB": 0.80, "WR": 0.45, "TE": 0.50}
PRIOR_GAMES = 16.0
TEAM_ALIASES = {"LA": "LAR", "OAK": "LV", "SD": "LAC", "STL": "LAR"}


def normalize_team(value: object) -> str:
    team = str(value).strip().upper()
    return TEAM_ALIASES.get(team, team)


def season_metrics(frame: pd.DataFrame, season: int) -> pd.DataFrame:
    rows = frame.loc[
        frame.season.eq(season)
        & frame.season_type.eq("REG")
        & frame.historical_position.isin(POSITIONS)
        & frame.opponent_team.notna(),
        ["game_id", "opponent_team", "historical_position", "fantasy_points_ppr"],
    ].copy()
    rows["opponent_team"] = rows.opponent_team.map(normalize_team)
    per_game = (
        rows.groupby(["game_id", "opponent_team", "historical_position"], as_index=False)
        .fantasy_points_ppr.sum()
    )
    return (
        per_game.groupby(["opponent_team", "historical_position"], as_index=False)
        .fantasy_points_ppr.agg(["mean", "count"]).reset_index()
        .rename(columns={"opponent_team": "team", "historical_position": "position", "mean": "points_allowed_per_game", "count": "games"})
    )


def build_lookup(frame: pd.DataFrame, season: int) -> dict:
    metrics = season_metrics(frame, season)
    previous = season_metrics(frame, season - 1).rename(columns={"points_allowed_per_game": "previous"})
    output: dict[str, object] = {"season": season, "scoring": "neutral_ppr", "rank_convention": "1=hardest,32=easiest", "positions": {}}
    for position in POSITIONS:
        rows = metrics.loc[metrics.position.eq(position)].copy().sort_values("points_allowed_per_game")
        if len(rows) != 32:
            raise ValueError(f"Expected 32 {position} defenses for {season}; found {len(rows)}")
        league_average = float(rows.points_allowed_per_game.mean())
        rows["shrunk_deviation"] = (
            rows.points_allowed_per_game - league_average
        ) * rows.games / (rows.games + PRIOR_GAMES)
        low, high = rows.shrunk_deviation.quantile([0.10, 0.90])
        robust_scale = max(abs(float(low)), abs(float(high)), 0.01)
        rows["normalized_factor"] = (rows.shrunk_deviation / robust_scale).clip(-1, 1)
        rows["adjustment_ppg"] = rows.normalized_factor * POSITION_CAPS[position]
        rows["rank"] = rows.points_allowed_per_game.rank(method="first", ascending=True).astype(int)
        joined = rows.merge(previous.loc[previous.position.eq(position), ["team", "previous"]], on="team", how="left")
        stability = float(joined.points_allowed_per_game.corr(joined.previous))
        output["positions"][position] = {
            "league_average": league_average,
            "soft_cap_ppg": POSITION_CAPS[position],
            "prior_games": PRIOR_GAMES,
            "year_over_year_correlation": None if not np.isfinite(stability) else stability,
            "defenses": {
                row.team: {
                    "points_allowed_per_game": float(row.points_allowed_per_game),
                    "games": int(row.games),
                    "rank": int(row.rank),
                    "normalized_factor": float(row.normalized_factor),
                    "adjustment_ppg": float(row.adjustment_ppg),
                }
                for row in rows.itertuples()
            },
        }
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=2025)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    frame = pd.read_csv(args.input)
    output = build_lookup(frame, args.season)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    summary = {}
    for position, details in output["positions"].items():
        ordered = sorted(details["defenses"].items(), key=lambda item: item[1]["rank"])
        summary[position] = {"hardest": ordered[0], "easiest": ordered[-1], "cap": details["soft_cap_ppg"]}
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
