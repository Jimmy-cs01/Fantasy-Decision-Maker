from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .config import FANTASY_POSITIONS
from .features import build_inference_dataset, build_modeling_dataset
from .v3_config import (
    ADVANCED_ROLLING_WINDOWS,
    COMMON_ADVANCED_FEATURES,
    POSITION_ADVANCED_FEATURES,
    V3_FEATURE_COLUMNS_BY_POSITION,
)

ADVANCED_RAW_FEATURES = list(dict.fromkeys([
    *COMMON_ADVANCED_FEATURES,
    *(column for values in POSITION_ADVANCED_FEATURES.values() for column in values),
]))
ADVANCED_JOIN_KEY = ["player_id", "season", "week", "team"]


def read_advanced_weekly(path: Path) -> pd.DataFrame:
    available = pd.read_csv(path, nrows=0).columns.tolist()
    required = set(ADVANCED_JOIN_KEY + ["historical_position", "feature_version"])
    missing = sorted(required - set(available))
    if missing:
        raise ValueError(f"Advanced weekly data is missing required columns: {missing}")
    usecols = [column for column in [*required, *ADVANCED_RAW_FEATURES] if column in available]
    frame = pd.read_csv(path, usecols=usecols, dtype={"player_id": "string", "team": "string"})
    duplicates = frame.duplicated(ADVANCED_JOIN_KEY, keep=False)
    if duplicates.any():
        raise ValueError(f"Advanced weekly data has {int(duplicates.sum())} duplicate player-team-weeks")
    return frame


def _rolling(series: pd.Series, player_ids: pd.Series, window: int) -> pd.Series:
    shifted = series.groupby(player_ids, sort=False).shift(1)
    return (
        shifted.groupby(player_ids, sort=False)
        .rolling(window, min_periods=1)
        .mean()
        .reset_index(level=0, drop=True)
        .sort_index()
    )


def _season_average(frame: pd.DataFrame, values: pd.Series) -> pd.Series:
    present = values.notna().astype(int)
    values = values.fillna(0)
    keys = [frame["player_id"], frame["season"]]
    prior_sum = values.groupby(keys, sort=False).cumsum() - values
    prior_count = present.groupby(keys, sort=False).cumsum() - present
    return prior_sum.div(prior_count.replace(0, np.nan))


def _attach_advanced_history(base: pd.DataFrame, advanced: pd.DataFrame) -> pd.DataFrame:
    columns = ADVANCED_JOIN_KEY + [column for column in ADVANCED_RAW_FEATURES if column in advanced]
    frame = base.merge(
        advanced[columns],
        on=ADVANCED_JOIN_KEY,
        how="left",
        validate="one_to_one",
    ).sort_values(["player_id", "season", "week", "game_id"]).reset_index(drop=True)
    derived: dict[str, pd.Series] = {}
    for column in ADVANCED_RAW_FEATURES:
        values = (
            pd.to_numeric(frame[column], errors="coerce")
            if column in frame
            else pd.Series(np.nan, index=frame.index, dtype=float)
        )
        derived[f"{column}_season_avg"] = _season_average(frame, values)
        for window in ADVANCED_ROLLING_WINDOWS:
            derived[f"{column}_l{window}"] = _rolling(values, frame["player_id"], window)
    frame = pd.concat([frame, pd.DataFrame(derived, index=frame.index)], axis=1)
    return frame.sort_values(["season", "week", "player_id"]).reset_index(drop=True)


def build_v3_modeling_dataset(
    historical: pd.DataFrame,
    advanced: pd.DataFrame,
    schedule: pd.DataFrame | None = None,
) -> pd.DataFrame:
    base = build_modeling_dataset(historical, schedule)
    return _attach_advanced_history(base, advanced)


def _pregame_advanced_for_inference(
    advanced: pd.DataFrame,
    player_ids: pd.Series,
    season: int,
    week: int,
) -> pd.DataFrame:
    eligible = advanced.loc[
        (advanced["season"] < season)
        | ((advanced["season"] == season) & (advanced["week"] < week))
    ].sort_values(["player_id", "season", "week"])
    rows: list[dict[str, object]] = []
    for player_id in player_ids.astype("string"):
        history = eligible.loc[eligible["player_id"].eq(player_id)]
        current_season = history.loc[history["season"].eq(season)]
        row: dict[str, object] = {"player_id": player_id}
        for column in ADVANCED_RAW_FEATURES:
            values = pd.to_numeric(history[column], errors="coerce").dropna()
            season_values = pd.to_numeric(current_season[column], errors="coerce").dropna()
            row[f"{column}_season_avg"] = season_values.mean() if len(season_values) else np.nan
            for window in ADVANCED_ROLLING_WINDOWS:
                row[f"{column}_l{window}"] = values.tail(window).mean() if len(values) else np.nan
        rows.append(row)
    return pd.DataFrame(rows)


def build_v3_inference_dataset(
    historical: pd.DataFrame,
    advanced: pd.DataFrame,
    season: int,
    week: int,
    schedule: pd.DataFrame | None = None,
) -> pd.DataFrame:
    base = build_inference_dataset(historical, season, week, schedule)
    features = _pregame_advanced_for_inference(advanced, base["player_id"], season, week)
    return base.merge(features, on="player_id", how="left", validate="one_to_one")


def validate_v3_dataset(frame: pd.DataFrame) -> None:
    identity = ["player_id", "season", "week", "season_type", "game_id"]
    if frame[identity[:3]].isna().any().any():
        raise ValueError("v3 player_id, season, and week must not be null")
    duplicates = frame.duplicated(identity, keep=False)
    if duplicates.any():
        raise ValueError(f"v3 dataset contains {int(duplicates.sum())} duplicate player-weeks")
    forbidden = {"player_id", "player_name", "sleeper_player_id", "game_id"}
    for position in FANTASY_POSITIONS:
        features = V3_FEATURE_COLUMNS_BY_POSITION[position]
        leaked = sorted(forbidden.intersection(features))
        if leaked:
            raise ValueError(f"v3 {position} feature list contains identity leakage: {leaked}")
        missing = sorted(set(features) - set(frame.columns))
        if missing:
            raise ValueError(f"v3 {position} features are missing from dataset: {missing}")


def feature_audit(frame: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for position in FANTASY_POSITIONS:
        cohort = frame.loc[frame["historical_position"].eq(position)]
        for feature in V3_FEATURE_COLUMNS_BY_POSITION[position]:
            values = pd.to_numeric(cohort[feature], errors="coerce")
            coverage = float(values.notna().mean()) if len(values) else 0.0
            stddev = float(values.std()) if values.notna().any() else np.nan
            rows.append({
                "name": feature,
                "position": position,
                "rows": len(values),
                "coverage": round(coverage, 6),
                "missing_percentage": round((1 - coverage) * 100, 3),
                "mean": round(float(values.mean()), 6) if values.notna().any() else None,
                "stddev": round(stddev, 6) if np.isfinite(stddev) else None,
                "flag_high_missing": coverage < 0.5,
                "flag_near_zero_variance": bool(np.isfinite(stddev) and stddev < 1e-9),
                "leakage_risk": feature in {"fantasy_points_ppr", "player_id", "game_id"},
            })
    return pd.DataFrame(rows)
