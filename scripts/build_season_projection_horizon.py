#!/usr/bin/env python3
"""Expand a frozen active-game projection into a Week 1-17 outlook.

This is a storage/materialization layer, not a new model. It carries the frozen
football components forward, attaches the known schedule, emits zero-valued bye
rows, and never fabricates future Vegas or Sleeper evidence. Weekly production
runs can safely replace individual rows as real pregame context becomes known.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

if __package__:
    from .projection_pipeline.scoring import score_projected_stats_exact
else:
    from projection_pipeline.scoring import score_projected_stats_exact

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data/processed/player_projections_v4_1_release.csv"
DEFAULT_SCHEDULE = ROOT / "data/processed/schedules.csv"
DEFAULT_OUTPUT = ROOT / "data/processed/player_projections_v4_1_season.csv"
WEEKS = range(1, 18)
DEFENSE_LOOKUP = ROOT / "lib/projections/defense-vs-position-2025.json"


def load_defense_lookup(path: Path = DEFENSE_LOOKUP) -> dict:
    return json.loads(path.read_text())


def opponent_adjustment(lookup: dict, position: str, opponent: str | None) -> dict | None:
    position_data = lookup.get("positions", {}).get(str(position).upper())
    defense = position_data.get("defenses", {}).get(str(opponent)) if position_data and opponent else None
    if not defense:
        return None
    return {
        **defense,
        "season": int(lookup["season"]),
        "league_average": float(position_data["league_average"]),
        "soft_cap_ppg": float(position_data["soft_cap_ppg"]),
    }


def apply_matchup_delta(stats: dict, position: str, delta: float) -> dict:
    output = dict(stats)
    sink = "passing_yards" if position == "QB" else "rushing_yards" if position == "RB" else "receiving_yards"
    rate = 0.04 if position == "QB" else 0.1
    output[sink] = max(0.0, float(output.get(sink, 0) or 0) + delta / rate)
    return output


def zero_stats(value: object) -> str:
    stats = json.loads(str(value))
    return json.dumps({key: 0.0 for key in stats}, sort_keys=True)


def drivers(value: object, message: str) -> str:
    current = json.loads(str(value))
    return json.dumps([*current, message], sort_keys=True)


def build_horizon(base: pd.DataFrame, schedule: pd.DataFrame, season: int, defense_lookup: dict | None = None) -> pd.DataFrame:
    if base.duplicated(["gsis_id"]).any():
        raise ValueError("Projection seed must contain one row per player")
    games = schedule.loc[
        schedule.season.eq(season) & schedule.season_type.eq("REG") & schedule.week.between(1, 17),
        ["week", "team", "opponent_team"],
    ].drop_duplicates(["week", "team"])
    matchup = {(int(row.week), str(row.team)): str(row.opponent_team) for row in games.itertuples()}
    nfl_teams = set(games.team.astype(str))
    defense_lookup = defense_lookup or load_defense_lookup()
    rows: list[dict] = []
    for source in base.to_dict("records"):
        team = None if pd.isna(source.get("team")) else str(source["team"])
        position = str(source.get("position", ""))
        anchor_opponent = None if pd.isna(source.get("opponent_team")) else str(source.get("opponent_team"))
        anchor_strength = opponent_adjustment(defense_lookup, position, anchor_opponent)
        for week in WEEKS:
            row = dict(source)
            row.update({"season": season, "week": week, "season_type": "REG"})
            opponent = matchup.get((week, team)) if team else None
            teamless = not team or team not in nfl_teams
            bye = not teamless and opponent is None
            row["opponent_team"] = opponent
            row["is_bye"] = bye
            row["is_future_role_forecast"] = week != int(source.get("week", 1))
            if bye or teamless:
                row["projected_stats"] = zero_stats(source["projected_stats"])
                for column in (
                    "raw_model_projection_ppr", "opportunity_projection_ppr", "corrected_target_ppr",
                    "component_derived_ppr", "model_projection_ppr", "projected_points_standard",
                    "projected_points_half_ppr", "projected_points_ppr", "floor_ppr", "median_ppr", "ceiling_ppr",
                ):
                    if column in row:
                        row[column] = 0.0
                row["residual_low"] = 0.0
                row["residual_high"] = 0.0
                row["confidence"] = "high" if bye else "low"
                row["drivers"] = json.dumps(["NFL bye week" if bye else "No current NFL team"], sort_keys=True)
                row["base_projection_ppr"] = 0.0
                row["opponent_adjustment_ppg"] = 0.0
                row["opponent_defense_rank"] = None
                row["opponent_defense_metric"] = None
                row["opponent_defense_league_average"] = None
                row["opponent_defense_season"] = int(defense_lookup["season"])
            elif week != int(source.get("week", 1)):
                row["drivers"] = drivers(source["drivers"], "Current role carried forward; future Vegas not fabricated")
                for column in (
                    "vegas_projection_ppr", "sleeper_projection_ppr", "final_projection_ppr",
                    "vegas_confidence", "blend_weight_model",
                ):
                    if column in row:
                        row[column] = None
                if week >= 9:
                    row["confidence"] = "low"
                elif week >= 5 and row.get("confidence") == "high":
                    row["confidence"] = "medium"
            if not bye and not teamless:
                current_strength = opponent_adjustment(defense_lookup, position, opponent)
                base_ppr = score_projected_stats_exact(json.loads(str(row["projected_stats"])), {"rec": 1}, position)
                delta = 0.0
                if current_strength and anchor_strength:
                    cap = float(current_strength["soft_cap_ppg"])
                    delta = max(-cap, min(cap, float(current_strength["adjustment_ppg"]) - float(anchor_strength["adjustment_ppg"])))
                    stats = apply_matchup_delta(json.loads(str(row["projected_stats"])), position, delta)
                    row["projected_stats"] = json.dumps(stats, sort_keys=True)
                    row["projected_points_standard"] = score_projected_stats_exact(stats, {"rec": 0}, position)
                    row["projected_points_half_ppr"] = score_projected_stats_exact(stats, {"rec": .5}, position)
                    row["projected_points_ppr"] = score_projected_stats_exact(stats, {"rec": 1}, position)
                    if "floor_ppr" in row:
                        row["floor_ppr"] = max(0.0, float(source["floor_ppr"]) + delta)
                    if "median_ppr" in row:
                        row["median_ppr"] = max(0.0, float(source["median_ppr"]) + delta)
                    if "ceiling_ppr" in row:
                        row["ceiling_ppr"] = max(0.0, float(source["ceiling_ppr"]) + delta)
                row["base_projection_ppr"] = base_ppr
                row["opponent_adjustment_ppg"] = delta
                row["opponent_defense_rank"] = current_strength["rank"] if current_strength else None
                row["opponent_defense_metric"] = current_strength["points_allowed_per_game"] if current_strength else None
                row["opponent_defense_league_average"] = current_strength["league_average"] if current_strength else None
                row["opponent_defense_season"] = int(defense_lookup["season"])
            rows.append(row)
    output = pd.DataFrame(rows).sort_values(["gsis_id", "week"]).reset_index(drop=True)
    if output.duplicated(["gsis_id", "season", "week", "season_type"]).any():
        raise ValueError("Season horizon contains duplicate player-week rows")
    expected = len(base) * 17
    if len(output) != expected:
        raise ValueError(f"Expected {expected} player-week rows, built {len(output)}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a leakage-safe Week 1-17 projection horizon.")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--schedule", type=Path, default=DEFAULT_SCHEDULE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    base = pd.read_csv(args.input, dtype={"gsis_id": "string", "team": "string"})
    schedule = pd.read_csv(args.schedule, dtype={"team": "string", "opponent_team": "string"})
    output = build_horizon(base, schedule, args.season)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.to_csv(args.output, index=False)
    print(json.dumps({
        "players": int(output.gsis_id.nunique()),
        "weeks": sorted(output.week.unique().tolist()),
        "rows": len(output),
        "bye_rows": int(output.is_bye.sum()),
        "duplicates": int(output.duplicated(["gsis_id", "season", "week", "season_type"]).sum()),
        "future_vegas_fabricated": False,
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
