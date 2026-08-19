from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd

from .scoring import score_projected_stats_exact


SCORING_TOLERANCE = 1e-6


def _bool_column(frame: pd.DataFrame, name: str) -> pd.Series:
    if name not in frame:
        return pd.Series(False, index=frame.index)
    return frame[name].map(lambda value: bool(value) if pd.notna(value) else False).astype(bool)


def _number(frame: pd.DataFrame, name: str) -> pd.Series:
    if name not in frame:
        return pd.Series(np.nan, index=frame.index, dtype=float)
    return pd.to_numeric(frame[name], errors="coerce")


def _stats(value: Any) -> dict[str, float]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def current_projection_sanity(frame: pd.DataFrame, prediction: str = "model_projection_ppr") -> dict[str, object]:
    data = frame.copy()
    data["_prediction"] = _number(data, prediction)
    data["_stats"] = data.get("projected_stats", pd.Series({}, index=data.index)).map(_stats)
    data["_component_ppr"] = data.apply(
        lambda row: score_projected_stats_exact(
            row["_stats"], {"rec": 1.0}, str(row.get("position") or row.get("historical_position")),
        ),
        axis=1,
    )
    data["_component_residual"] = data["_prediction"] - data["_component_ppr"]
    position = data.get("position", data.get("historical_position", pd.Series("", index=data.index))).fillna("")
    depth = _number(data, "depth_rank")
    starter = _bool_column(data, "is_starter") | depth.eq(1)
    pass_attempts = data["_stats"].map(lambda value: float(value.get("pass_attempts", 0) or 0))
    targets = data["_stats"].map(lambda value: float(value.get("targets", 0) or 0))
    receptions = data["_stats"].map(lambda value: float(value.get("receptions", 0) or 0))
    completions = data["_stats"].map(lambda value: float(value.get("completions", 0) or 0))
    rush_attempts = data["_stats"].map(lambda value: float(value.get("rush_attempts", 0) or 0))

    masks = {
        "starting_qb_below_8_ppg": position.eq("QB") & starter & data._prediction.lt(8),
        "starting_qb_below_18_attempts": position.eq("QB") & starter & pass_attempts.lt(18),
        "starting_qb_below_22_attempts_warning": position.eq("QB") & starter & pass_attempts.lt(22),
        "rb4_plus_above_8_ppg": position.eq("RB") & depth.ge(4) & data._prediction.gt(8),
        "teamless_above_1_ppg": data.get("team", pd.Series(np.nan, index=data.index)).isna() & data._prediction.gt(1),
        "component_ppr_mismatch": data._component_residual.abs().gt(SCORING_TOLERANCE),
        "receptions_exceed_targets": receptions.gt(targets + SCORING_TOLERANCE),
        "completions_exceed_attempts": completions.gt(pass_attempts + SCORING_TOLERANCE),
        "negative_volume": targets.lt(0) | receptions.lt(0) | pass_attempts.lt(0) | completions.lt(0) | rush_attempts.lt(0),
    }
    identifiers = [column for column in ("gsis_id", "player_id", "player_name", "team", "position", prediction) if column in data]
    violations = {
        name: {
            "count": int(mask.sum()),
            "players": data.loc[mask, identifiers].head(50).replace({np.nan: None}).to_dict("records"),
        }
        for name, mask in masks.items()
    }

    team_violations: list[dict[str, object]] = []
    if "team" in data:
        for team, group in data.dropna(subset=["team"]).groupby("team"):
            group_positions = position.loc[group.index]
            team_targets = float(targets.loc[group.index].sum())
            # Multiple quarterbacks can legitimately contribute attempts in one
            # team-game. Compare receivers with the complete team passing
            # opportunity, not the single largest QB row.
            qb_attempts = float(pass_attempts.loc[group.index][group_positions.eq("QB")].sum()) if group_positions.eq("QB").any() else 0
            allowable_targets = qb_attempts * 0.97
            if qb_attempts > 0 and team_targets > allowable_targets + 0.5:
                team_violations.append({
                    "team": team,
                    "assigned_targets": round(team_targets, 3),
                    "projected_qb_attempts": round(qb_attempts, 3),
                    "allowable_targets": round(allowable_targets, 3),
                    "excess": round(team_targets - allowable_targets, 3),
                })

    material_team_warnings = sum(float(item["excess"]) > 2 for item in team_violations)
    severe = (
        violations["starting_qb_below_8_ppg"]["count"]
        + violations["starting_qb_below_18_attempts"]["count"]
        + violations["component_ppr_mismatch"]["count"]
        + violations["negative_volume"]["count"]
        + material_team_warnings
    )
    return {
        "rows": int(len(data)),
        "prediction": prediction,
        "violations": violations,
        "team_target_vs_qb_attempt_warnings": team_violations,
        "material_team_target_vs_qb_attempt_warnings": material_team_warnings,
        "severe_violation_count": int(severe),
        "promotion_safe": severe == 0,
    }
