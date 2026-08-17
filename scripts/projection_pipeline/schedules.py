from __future__ import annotations

from pathlib import Path

import pandas as pd

SCHEDULE_COLUMNS = [
    "game_id", "season", "game_type", "week", "gameday", "weekday",
    "away_team", "home_team", "location", "away_rest", "home_rest",
]


def normalize_schedules(games: pd.DataFrame, start_season: int = 2012) -> pd.DataFrame:
    missing = sorted(set(SCHEDULE_COLUMNS) - set(games.columns))
    if missing:
        raise ValueError(f"nflverse schedule is missing required columns: {missing}")
    games = games.loc[
        games["season"].ge(start_season) & games["game_type"].isin(["REG", "POST"]),
        SCHEDULE_COLUMNS,
    ].copy()
    games["gameday"] = pd.to_datetime(games["gameday"], errors="coerce")
    if games[["game_id", "season", "week", "away_team", "home_team"]].isna().any().any():
        raise ValueError("Schedule contains null game identities")

    common = ["game_id", "season", "game_type", "week", "gameday", "weekday", "location"]
    away = games[common + ["away_team", "home_team", "away_rest"]].rename(columns={
        "away_team": "team", "home_team": "opponent_team", "away_rest": "days_rest",
    })
    away["is_home"] = 0
    home = games[common + ["home_team", "away_team", "home_rest"]].rename(columns={
        "home_team": "team", "away_team": "opponent_team", "home_rest": "days_rest",
    })
    home["is_home"] = 1
    schedule = pd.concat([away, home], ignore_index=True)
    schedule["season_type"] = schedule.pop("game_type")
    schedule["neutral_site"] = schedule["location"].astype("string").str.lower().eq("neutral").astype(int)
    schedule["days_rest"] = pd.to_numeric(schedule["days_rest"], errors="coerce")
    schedule["short_week"] = schedule["days_rest"].le(6).astype(int)
    schedule["long_rest"] = schedule["days_rest"].ge(10).astype(int)
    schedule["returning_from_bye"] = schedule["days_rest"].ge(13).astype(int)
    schedule["is_thursday"] = schedule["weekday"].astype("string").str.lower().eq("thursday").astype(int)
    schedule["game_date"] = schedule.pop("gameday").dt.strftime("%Y-%m-%d")
    schedule = schedule.drop(columns=["location", "weekday"])
    logical_key = ["season", "week", "season_type", "team"]
    duplicates = schedule.duplicated(logical_key, keep=False)
    if duplicates.any():
        sample = schedule.loc[duplicates, logical_key].head().to_dict("records")
        raise ValueError(f"Schedule has duplicate team-week rows: {sample}")
    return schedule.sort_values(["season", "week", "team"]).reset_index(drop=True)


def read_normalized_schedule(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(
            f"Normalized schedule not found at {path}. Run: npm run data:schedules"
        )
    frame = pd.read_csv(path, dtype={"team": "string", "opponent_team": "string"})
    required = {"season", "week", "season_type", "team", "opponent_team", "is_home"}
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Normalized schedule is missing required columns: {missing}")
    return frame


def schedule_for_week(schedule: pd.DataFrame, season: int, week: int) -> pd.DataFrame:
    rows = schedule.loc[
        schedule["season"].eq(season)
        & schedule["week"].eq(week)
        & schedule["season_type"].eq("REG")
    ].copy()
    return rows.drop_duplicates(["team"], keep=False)
