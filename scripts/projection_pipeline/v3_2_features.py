from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

SNAP_JOIN_KEY = ["player_id", "season", "week", "season_type"]


def read_snap_weekly(path: Path) -> pd.DataFrame:
    columns = pd.read_csv(path, nrows=0).columns.tolist()
    required = set(SNAP_JOIN_KEY + [
        "team", "historical_position", "offensive_snaps",
        "team_offensive_snaps", "offensive_snap_pct",
    ])
    missing = sorted(required - set(columns))
    if missing:
        raise ValueError(f"Snap data is missing required columns: {missing}")
    frame = pd.read_csv(
        path,
        usecols=list(required),
        dtype={"player_id": "string", "team": "string", "season_type": "string"},
    )
    snap_pct = pd.to_numeric(frame["offensive_snap_pct"], errors="coerce")
    invalid_scale = snap_pct.notna() & ~snap_pct.between(0, 1)
    if invalid_scale.any():
        raise ValueError(
            "Snap percentages must use a 0-1 scale; "
            f"found {int(invalid_scale.sum())} out-of-range rows"
        )
    duplicates = frame.duplicated(SNAP_JOIN_KEY, keep=False)
    if duplicates.any():
        raise ValueError(f"Snap data has {int(duplicates.sum())} duplicate player-weeks")
    frame["snap_source_row"] = 1
    return frame


def _shifted_rolling(values: pd.Series, player_ids: pd.Series, window: int, operation: str = "mean") -> pd.Series:
    shifted = values.groupby(player_ids, sort=False).shift(1)
    rolling = shifted.groupby(player_ids, sort=False).rolling(window, min_periods=1)
    result = rolling.mean() if operation == "mean" else rolling.count()
    return result.reset_index(level=0, drop=True).sort_index()


def _current_position_group_share(frame: pd.DataFrame) -> pd.Series:
    keys = [frame["season"], frame["week"], frame["season_type"], frame["team"], frame["historical_position"]]
    denominator = frame["offensive_snaps"].groupby(keys, dropna=False).transform("sum")
    return frame["offensive_snaps"].div(denominator.replace(0, np.nan))


def attach_shifted_snap_features(base: pd.DataFrame, snaps: pd.DataFrame) -> pd.DataFrame:
    """Attach pregame snap context; prediction-week snaps only create future rows."""
    columns = SNAP_JOIN_KEY + [
        "team", "historical_position", "offensive_snaps",
        "team_offensive_snaps", "offensive_snap_pct", "snap_source_row",
    ]
    snap = snaps[columns].rename(columns={
        "team": "snap_team", "historical_position": "snap_position",
    })
    frame = base.merge(snap, on=SNAP_JOIN_KEY, how="left", validate="one_to_one")
    frame = frame.sort_values(["player_id", "season", "week", "game_id"]).reset_index(drop=True)
    ids = frame["player_id"]
    snap_pct = pd.to_numeric(frame["offensive_snap_pct"], errors="coerce")
    snap_count = pd.to_numeric(frame["offensive_snaps"], errors="coerce")
    source_present = frame["snap_source_row"].fillna(0).astype(int)

    # Missing is deliberately NaN, while a real zero-snap row remains 0.0.
    frame["snap_pct_last_1"] = snap_pct.groupby(ids, sort=False).shift(1)
    frame["snap_pct_last_3"] = _shifted_rolling(snap_pct, ids, 3)
    frame["snap_pct_last_5"] = _shifted_rolling(snap_pct, ids, 5)
    frame["snap_games_last_3"] = _shifted_rolling(snap_pct, ids, 3, "count")
    frame["snap_games_last_5"] = _shifted_rolling(snap_pct, ids, 5, "count")
    frame["snap_history_available"] = source_present.groupby(ids, sort=False).shift(1).rolling(1).max().fillna(0)
    prior_two = snap_pct.groupby(ids, sort=False).shift(2)
    frame["snap_pct_delta_1"] = frame["snap_pct_last_1"] - prior_two
    frame["snap_pct_trend_3"] = frame["snap_pct_last_1"] - frame["snap_pct_last_3"]

    current_group_share = _current_position_group_share(frame.assign(offensive_snaps=snap_count))
    frame["position_group_snap_share_last_1"] = current_group_share.groupby(ids, sort=False).shift(1)
    frame["position_group_snap_share_last_3"] = _shifted_rolling(current_group_share, ids, 3)

    rates = {
        "rush_attempts_per_snap_last_3": pd.to_numeric(frame["rush_attempts"], errors="coerce"),
        "targets_per_snap_last_3": pd.to_numeric(frame["targets"], errors="coerce"),
        "touches_per_snap_last_3": pd.to_numeric(frame["true_touches"], errors="coerce"),
    }
    for name, numerator in rates.items():
        per_snap = numerator.div(snap_count.replace(0, np.nan)).clip(0, 1)
        frame[name] = _shifted_rolling(per_snap, ids, 3)

    # Cross-season information is retained but marked so inference can discount
    # stale role evidence when the player changed teams.
    prior_team = frame["snap_team"].groupby(ids, sort=False).shift(1)
    prior_season = frame["season"].groupby(ids, sort=False).shift(1)
    frame["snap_prior_same_team"] = prior_team.eq(frame["team"]).astype(float).where(prior_team.notna())
    frame["snap_prior_same_season"] = prior_season.eq(frame["season"]).astype(float).where(prior_season.notna())
    return frame.sort_values(["season", "week", "player_id"]).reset_index(drop=True)


def snap_features_for_inference(
    inference: pd.DataFrame,
    historical_base: pd.DataFrame,
    snaps: pd.DataFrame,
    season: int,
    week: int,
) -> pd.DataFrame:
    synthetic = inference.copy()
    synthetic["season"] = season
    synthetic["week"] = week
    synthetic["season_type"] = synthetic.get("season_type", "REG")
    synthetic["game_id"] = synthetic.get("game_id", f"{season}_{week:02d}_INFERENCE")
    for column in ("rush_attempts", "targets", "true_touches"):
        if column not in synthetic:
            synthetic[column] = np.nan
    history_columns = [
        "player_id", "season", "week", "season_type", "game_id", "team",
        "historical_position", "rush_attempts", "targets", "true_touches",
    ]
    combined = pd.concat([historical_base[history_columns], synthetic[history_columns]], ignore_index=True)
    enriched = attach_shifted_snap_features(combined, snaps)
    current = enriched.loc[enriched["season"].eq(season) & enriched["week"].eq(week)]
    snap_columns = [column for column in enriched.columns if column.startswith("snap_") or column.startswith("position_group_") or column.endswith("_per_snap_last_3")]
    return inference.drop(columns=[column for column in snap_columns if column in inference], errors="ignore").merge(
        current[["player_id", *snap_columns]], on="player_id", how="left", validate="one_to_one",
    )
