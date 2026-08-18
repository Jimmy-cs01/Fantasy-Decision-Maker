from __future__ import annotations

from collections.abc import Mapping


STANDARD = {
    "pass_yd": 0.04, "pass_td": 4.0, "pass_int": -2.0,
    "rush_yd": 0.1, "rush_td": 6.0, "rec": 0.0,
    "rec_yd": 0.1, "rec_td": 6.0,
}

STAT_KEYS = {
    "pass_yd": "passing_yards", "pass_td": "passing_touchdowns",
    "pass_int": "interceptions_thrown", "rush_yd": "rushing_yards",
    "rush_td": "rushing_touchdowns", "rec": "receptions",
    "rec_yd": "receiving_yards", "rec_td": "receiving_touchdowns",
    "pass_cmp": "completions", "pass_att": "pass_attempts",
    "pass_fd": "passing_first_downs", "rush_att": "rush_attempts",
    "rush_fd": "rushing_first_downs", "rec_fd": "receiving_first_downs",
}


def score_projected_stats(
    stats: Mapping[str, float],
    settings: Mapping[str, float] | None = None,
    position: str | None = None,
) -> float:
    return round(score_projected_stats_exact(stats, settings, position), 2)


def score_projected_stats_exact(
    stats: Mapping[str, float],
    settings: Mapping[str, float] | None = None,
    position: str | None = None,
) -> float:
    """Score one stat line without presentation rounding.

    Model reconciliation uses this function as its canonical contract. UI and
    CSV presentation can still use ``score_projected_stats``'s two decimals.
    """
    rates = dict(STANDARD)
    rates.update(settings or {})
    points = sum(float(stats.get(STAT_KEYS[key], 0) or 0) * rate for key, rate in rates.items() if key in STAT_KEYS)
    if settings:
        incompletions = max(0.0, float(stats.get("pass_attempts", 0) or 0) - float(stats.get("completions", 0) or 0))
        points += incompletions * float(settings.get("pass_inc", 0) or 0)
        if position:
            points += float(stats.get("receptions", 0) or 0) * float(settings.get(f"bonus_rec_{position.lower()}", 0) or 0)
    return float(points)


def default_scores(stats: Mapping[str, float], position: str | None = None) -> dict[str, float]:
    return {
        "standard": score_projected_stats(stats, position=position),
        "half_ppr": score_projected_stats(stats, {"rec": 0.5}, position),
        "ppr": score_projected_stats(stats, {"rec": 1.0}, position),
    }


def reconcile_stat_line(
    stats: Mapping[str, float],
    direct_ppr: float,
    position: str | None = None,
) -> tuple[dict[str, float], float]:
    """Calibrate independently modeled components to the stronger direct PPR target.

    The stat models preserve the shape needed for custom Sleeper scoring, while
    one shared factor prevents their independently estimated components from
    summing to an implausibly different fantasy projection.
    """
    component_ppr = default_scores(stats, position)["ppr"]
    if component_ppr <= 0 or direct_ppr <= 0:
        return dict(stats), 1.0
    factor = min(1.5, max(0.5, direct_ppr / component_ppr))
    return {
        key: max(0.0, float(value) * factor)
        for key, value in stats.items()
    }, factor
