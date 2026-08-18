from __future__ import annotations

from collections.abc import Mapping

from .scoring import score_projected_stats_exact
from .v3_3_config import SCORING_TOLERANCE


NONNEGATIVE_FIELDS = (
    "pass_attempts", "completions", "passing_yards", "passing_touchdowns",
    "interceptions_thrown", "rush_attempts", "rushing_yards",
    "rushing_touchdowns", "targets", "receptions", "receiving_yards",
    "receiving_touchdowns", "passing_first_downs", "rushing_first_downs",
    "receiving_first_downs", "red_zone_carries", "inside_10_carries",
    "inside_5_carries", "red_zone_targets", "inside_10_targets",
    "red_zone_pass_attempts",
)


def clean_components(stats: Mapping[str, float]) -> dict[str, float]:
    output = {key: float(value or 0) for key, value in stats.items()}
    for key in NONNEGATIVE_FIELDS:
        if key in output:
            output[key] = max(0.0, output[key])
    if "completions" in output:
        output["completions"] = min(output["completions"], output.get("pass_attempts", output["completions"]))
    if "receptions" in output:
        output["receptions"] = min(output["receptions"], output.get("targets", output["receptions"]))
    if "passing_first_downs" in output:
        output["passing_first_downs"] = min(output["passing_first_downs"], output.get("completions", output["passing_first_downs"]))
    if "receiving_first_downs" in output:
        output["receiving_first_downs"] = min(output["receiving_first_downs"], output.get("receptions", output["receiving_first_downs"]))
    if "rushing_first_downs" in output:
        output["rushing_first_downs"] = min(output["rushing_first_downs"], output.get("rush_attempts", output["rushing_first_downs"]))
    return output


def _positive_scoring_points(stats: Mapping[str, float]) -> float:
    return (
        float(stats.get("passing_yards", 0)) * 0.04
        + float(stats.get("passing_touchdowns", 0)) * 4
        + float(stats.get("rushing_yards", 0)) * 0.1
        + float(stats.get("rushing_touchdowns", 0)) * 6
        + float(stats.get("receptions", 0))
        + float(stats.get("receiving_yards", 0)) * 0.1
        + float(stats.get("receiving_touchdowns", 0)) * 6
    )


def reconcile_components_exact(
    stats: Mapping[str, float],
    direct_target: float,
    position: str,
) -> tuple[dict[str, float], float, dict[str, float | str]]:
    """Return coherent components and their exact canonical PPR score.

    Stage one preserves the old bounded calibration. Stage two resolves any
    remaining residual through production components only. Opportunity fields
    (targets/attempts) are never manufactured by a fantasy-points target.
    """
    cleaned = clean_components(stats)
    component_score = score_projected_stats_exact(cleaned, {"rec": 1.0}, position)
    target = max(0.0, float(direct_target))
    factor = 1.0 if component_score <= 0 or target <= 0 else min(1.5, max(0.5, target / component_score))
    bounded = dict(cleaned)
    for key in (
        "passing_yards", "passing_touchdowns", "interceptions_thrown",
        "rushing_yards", "rushing_touchdowns", "receptions",
        "receiving_yards", "receiving_touchdowns",
    ):
        if key in bounded:
            bounded[key] *= factor
    bounded = clean_components(bounded)
    before = score_projected_stats_exact(bounded, {"rec": 1.0}, position)
    residual = target - before
    mode = "bounded"

    if abs(residual) > SCORING_TOLERANCE:
        if residual < 0:
            positive = _positive_scoring_points(bounded)
            negative = -2.0 * float(bounded.get("interceptions_thrown", 0))
            desired_positive = max(0.0, target - negative)
            scale = min(1.0, desired_positive / positive) if positive > 0 else 0.0
            for key in (
                "passing_yards", "passing_touchdowns", "rushing_yards",
                "rushing_touchdowns", "receptions", "receiving_yards",
                "receiving_touchdowns",
            ):
                if key in bounded:
                    bounded[key] *= scale
            mode = "residual_down"
        else:
            # Yards are continuous and do not alter opportunity budgets. They
            # provide a deterministic residual sink without inventing targets,
            # carries, catches or touchdowns.
            sink = "passing_yards" if position == "QB" else (
                "receiving_yards" if position in {"WR", "TE"} or bounded.get("targets", 0) > 0
                else "rushing_yards"
            )
            rate = 0.04 if sink == "passing_yards" else 0.1
            bounded[sink] = float(bounded.get(sink, 0)) + residual / rate
            mode = "residual_up"

    final = clean_components(bounded)
    score = score_projected_stats_exact(final, {"rec": 1.0}, position)
    closing = target - score
    if closing > SCORING_TOLERANCE:
        sink = "passing_yards" if position == "QB" else (
            "receiving_yards" if position in {"WR", "TE"} or final.get("targets", 0) > 0
            else "rushing_yards"
        )
        rate = 0.04 if sink == "passing_yards" else 0.1
        final[sink] = float(final.get(sink, 0)) + closing / rate
    elif closing < -SCORING_TOLERANCE:
        points_to_remove = -closing
        for key, rate in (
            ("passing_yards", 0.04), ("receiving_yards", 0.1),
            ("rushing_yards", 0.1), ("receptions", 1.0),
            ("passing_touchdowns", 4.0), ("receiving_touchdowns", 6.0),
            ("rushing_touchdowns", 6.0),
        ):
            available = float(final.get(key, 0)) * rate
            removed = min(points_to_remove, available)
            if removed:
                final[key] -= removed / rate
                points_to_remove -= removed
            if points_to_remove <= SCORING_TOLERANCE:
                break
    final = clean_components(final)
    score = score_projected_stats_exact(final, {"rec": 1.0}, position)
    return final, score, {
        "bounded_factor": float(factor),
        "pre_residual_score": float(before),
        "requested_target": target,
        "final_residual": float(target - score),
        "mode": mode,
    }
