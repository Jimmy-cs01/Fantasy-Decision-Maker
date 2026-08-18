from __future__ import annotations

import numpy as np
import pandas as pd

from .v3_3_config import ESTABLISHED_STARTER_MAX_DROP, RISING_ROLE_V3_2_WEIGHT
from .v3_3_model import established_starter_mask, rising_role_mask


def apply_current_team_context(
    frame: pd.DataFrame,
    current_roles: pd.DataFrame,
    schedule: pd.DataFrame,
    season: int,
    week: int,
) -> pd.DataFrame:
    """Apply current roster team before allocating opportunity or matchup context."""
    output = frame.copy()
    roles = current_roles[["player_id", "team"]].dropna().drop_duplicates("player_id").rename(
        columns={"team": "current_team"},
    )
    output = output.merge(roles, on="player_id", how="left", validate="one_to_one")
    output["prior_team"] = output["team"]
    team_features = [column for column in output if column.startswith("team_")]
    historical_environment = output.groupby("team", dropna=False)[team_features].median(numeric_only=True)
    output["team"] = output["current_team"].fillna(output["team"])
    changed = output["current_team"].notna() & output["prior_team"].ne(output["current_team"])
    for column in team_features:
        replacement = output["team"].map(historical_environment[column])
        output.loc[changed & replacement.notna(), column] = replacement.loc[changed & replacement.notna()]

    context_columns = [
        "opponent_team", "days_rest", "is_home", "neutral_site", "short_week",
        "long_rest", "returning_from_bye", "is_thursday",
    ]
    games = schedule.loc[
        schedule["season"].eq(season) & schedule["week"].eq(week),
        ["team", *context_columns],
    ].drop_duplicates("team")
    output = output.drop(columns=context_columns, errors="ignore").merge(
        games, on="team", how="left", validate="many_to_one",
    )
    return output.drop(columns=["current_team"])


def unexplained_qb1_suppression_mask(
    frame: pd.DataFrame,
    predictions: np.ndarray,
    threshold: float = 10.0,
) -> pd.Series:
    """Diagnostic only: healthy-role QB1 projections requiring explanation."""
    projected = pd.Series(np.asarray(predictions, dtype=float), index=frame.index)
    qb1 = frame["historical_position"].eq("QB") & (
        frame.get("is_starter", pd.Series(False, index=frame.index)).fillna(False).astype(bool)
        | frame.get("depth_rank", pd.Series(np.nan, index=frame.index)).eq(1)
    )
    demonstrated = frame.get("snap_pct_last_1", pd.Series(np.nan, index=frame.index)).fillna(0).ge(0.70)
    return qb1 & demonstrated & projected.lt(threshold)


def apply_protective_role_corrections(
    frame: pd.DataFrame,
    v3_1: np.ndarray,
    corrected_candidate: np.ndarray,
) -> tuple[np.ndarray, dict[str, int]]:
    """Protect genuine rising/stable roles without pulling improved output down."""
    result = np.asarray(corrected_candidate, dtype=float).copy()
    baseline = np.asarray(v3_1, dtype=float)
    rising = rising_role_mask(frame).to_numpy()
    rising_anchor = baseline * (1 - RISING_ROLE_V3_2_WEIGHT) + result * RISING_ROLE_V3_2_WEIGHT
    result[rising] = np.maximum(result[rising], rising_anchor[rising])
    established = established_starter_mask(frame).to_numpy()
    established_floor = baseline - ESTABLISHED_STARTER_MAX_DROP
    established_applied = established & (established_floor > result)
    result[established] = np.maximum(
        result[established], established_floor[established],
    )
    return np.maximum(0, result), {
        "rising_role_rows": int(rising.sum()),
        "rising_anchor_applied": int((rising & (rising_anchor > corrected_candidate)).sum()),
        "established_rows": int(established.sum()),
        "established_floor_applied": int(established_applied.sum()),
    }
