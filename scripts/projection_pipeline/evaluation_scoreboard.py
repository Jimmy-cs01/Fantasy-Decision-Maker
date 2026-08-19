from __future__ import annotations

import math
import numpy as np
import pandas as pd


ACTUAL_COLUMN = "fantasy_points_ppr"
POSITIONS = ("QB", "RB", "WR", "TE")
TOP_K = {"QB": 12, "RB": 12, "WR": 12, "TE": 6}
PAIRWISE_BUCKETS = ((0, 1, "<1"), (1, 2, "1-2"), (2, 4, "2-4"), (4, math.inf, "4+"))


def _finite(actual: np.ndarray, predicted: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mask = np.isfinite(actual) & np.isfinite(predicted)
    return actual[mask].astype(float), predicted[mask].astype(float)


def _numeric_column(frame: pd.DataFrame, name: str, default: float = np.nan) -> pd.Series:
    if name not in frame:
        return pd.Series(default, index=frame.index, dtype=float)
    return pd.to_numeric(frame[name], errors="coerce")


def regression_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | int | None]:
    actual, predicted = _finite(np.asarray(actual), np.asarray(predicted))
    if not len(actual):
        return {"rows": 0}
    error = predicted - actual
    absolute = np.abs(error)
    pearson = np.corrcoef(actual, predicted)[0, 1] if len(actual) > 1 else np.nan
    spearman = pd.Series(actual).rank(method="average").corr(pd.Series(predicted).rank(method="average"))
    denominator = float(np.square(actual - actual.mean()).sum())
    return {
        "rows": int(len(actual)),
        "mae": round(float(absolute.mean()), 4),
        "rmse": round(float(np.sqrt(np.square(error).mean())), 4),
        "median_absolute_error": round(float(np.median(absolute)), 4),
        "bias": round(float(error.mean()), 4),
        "pearson": round(float(pearson), 4) if np.isfinite(pearson) else None,
        "spearman": round(float(spearman), 4) if pd.notna(spearman) else None,
        "r2": round(float(1 - np.square(error).sum() / denominator), 4) if denominator > 0 else None,
        "absolute_error_gt_5": round(float((absolute > 5).mean()), 4),
        "absolute_error_gt_10": round(float((absolute > 10).mean()), 4),
        "absolute_error_gt_15": round(float((absolute > 15).mean()), 4),
        "absolute_error_gt_20": round(float((absolute > 20).mean()), 4),
    }


def _weekly_groups(frame: pd.DataFrame):
    return frame.groupby(["season", "week", "historical_position"], dropna=False)


def ranking_metrics(frame: pd.DataFrame, prediction: str) -> dict[str, object]:
    captures: dict[str, list[float]] = {position: [] for position in POSITIONS}
    pairwise: dict[str, list[tuple[bool, float]]] = {label: [] for _, _, label in PAIRWISE_BUCKETS}
    for (_, _, position), group in _weekly_groups(frame):
        usable = group.dropna(subset=[ACTUAL_COLUMN, prediction])
        if len(usable) < 2 or position not in TOP_K:
            continue
        count = min(TOP_K[position], len(usable))
        actual_top = set(usable.nlargest(count, ACTUAL_COLUMN).player_id)
        predicted_top = set(usable.nlargest(count, prediction).player_id)
        captures[position].append(len(actual_top & predicted_top) / count)

        actual = usable[ACTUAL_COLUMN].to_numpy(float)
        predicted = usable[prediction].to_numpy(float)
        for left in range(len(usable)):
            predicted_difference = predicted[left] - predicted[left + 1 :]
            actual_difference = actual[left] - actual[left + 1 :]
            for projected, realized in zip(predicted_difference, actual_difference, strict=True):
                if projected == 0 or realized == 0:
                    continue
                gap = abs(float(projected))
                # Regret is invariant to player ordering: the realized gap is lost only when the model chose incorrectly.
                correct = bool(np.sign(projected) == np.sign(realized))
                regret = 0.0 if correct else abs(float(realized))
                for lower, upper, label in PAIRWISE_BUCKETS:
                    if lower <= gap < upper:
                        pairwise[label].append((correct, regret))
                        break
    return {
        "top_capture": {
            position: {
                "weeks": len(values),
                "rate": round(float(np.mean(values)), 4) if values else None,
                "top_k": TOP_K[position],
            }
            for position, values in captures.items()
        },
        "start_sit": {
            label: {
                "pairs": len(values),
                "accuracy": round(float(np.mean([correct for correct, _ in values])), 4) if values else None,
                "mean_regret": round(float(np.mean([regret for _, regret in values])), 4) if values else None,
            }
            for label, values in pairwise.items()
        },
    }


def role_change_masks(frame: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    snap_last = _numeric_column(frame, "snap_pct_last_1")
    snap_baseline = _numeric_column(frame, "snap_pct_last_3")
    increase = snap_last.sub(snap_baseline).ge(0.15)
    decrease = snap_last.sub(snap_baseline).le(-0.15)
    opportunity_pairs = (
        ("pbp_pass_attempts_l3", "pbp_pass_attempts_season_avg", 5.0),
        ("pbp_touches_l3", "pbp_touches_season_avg", 2.0),
        ("pbp_targets_l3", "pbp_targets_season_avg", 1.5),
    )
    for recent_name, baseline_name, minimum_change in opportunity_pairs:
        recent = _numeric_column(frame, recent_name)
        baseline = _numeric_column(frame, baseline_name)
        eligible = recent.notna() & baseline.notna()
        increase |= eligible & recent.sub(baseline).ge(minimum_change) & recent.ge(baseline * 1.35)
        decrease |= eligible & baseline.sub(recent).ge(minimum_change) & recent.le(baseline * 0.70)
    return increase.fillna(False), decrease.fillna(False)


def role_change_report(frame: pd.DataFrame, prediction: str) -> dict[str, object]:
    increase, decrease = role_change_masks(frame)
    report: dict[str, object] = {}
    baseline = _numeric_column(frame, "fantasy_points_ppr_season_avg")
    for label, mask in (("increase", increase), ("decrease", decrease)):
        selected = frame.loc[mask]
        metrics = regression_metrics(selected[ACTUAL_COLUMN].to_numpy(), selected[prediction].to_numpy())
        eligible = selected.loc[baseline.loc[selected.index].notna()]
        if len(eligible):
            predicted_direction = np.sign(eligible[prediction].to_numpy(float) - baseline.loc[eligible.index].to_numpy(float))
            actual_direction = np.sign(eligible[ACTUAL_COLUMN].to_numpy(float) - baseline.loc[eligible.index].to_numpy(float))
            non_ties = (predicted_direction != 0) & (actual_direction != 0)
            metrics["direction_accuracy"] = round(float((predicted_direction[non_ties] == actual_direction[non_ties]).mean()), 4) if non_ties.any() else None
        else:
            metrics["direction_accuracy"] = None
        report[label] = metrics
    return report


def _pinball(actual: np.ndarray, predicted: np.ndarray, quantile: float) -> float:
    residual = actual - predicted
    return float(np.maximum(quantile * residual, (quantile - 1) * residual).mean())


def chronological_quantile_calibration(frame: pd.DataFrame, prediction: str) -> dict[str, object]:
    evaluated: list[pd.DataFrame] = []
    for year in sorted(frame.season.dropna().unique()):
        calibration = frame.loc[frame.season.lt(year)].dropna(subset=[ACTUAL_COLUMN, prediction])
        validation = frame.loc[frame.season.eq(year)].dropna(subset=[ACTUAL_COLUMN, prediction]).copy()
        if len(calibration) < 200 or validation.empty:
            continue
        calibration = calibration.assign(_residual=calibration[ACTUAL_COLUMN] - calibration[prediction])
        for position, rows in validation.groupby("historical_position"):
            residuals = calibration.loc[calibration.historical_position.eq(position), "_residual"]
            if len(residuals) < 100:
                residuals = calibration["_residual"]
            offsets = residuals.quantile([0.2, 0.5, 0.8])
            rows = rows.copy()
            rows["p20"] = np.maximum(0, rows[prediction] + float(offsets.loc[0.2]))
            rows["p50"] = np.maximum(0, rows[prediction] + float(offsets.loc[0.5]))
            rows["p80"] = np.maximum(0, rows[prediction] + float(offsets.loc[0.8]))
            evaluated.append(rows)
    if not evaluated:
        return {"rows": 0, "method": "expanding-window residual quantiles"}
    output = pd.concat(evaluated, ignore_index=True)
    actual = output[ACTUAL_COLUMN].to_numpy(float)
    return {
        "rows": int(len(output)),
        "seasons": sorted(int(value) for value in output.season.unique()),
        "method": "expanding-window position residual quantiles; prior validation seasons only",
        # Strict inequality matches the calibration question: how often did the
        # outcome fall below the forecast quantile? Inclusive rates are retained
        # because zero-point outcomes create a material point mass at the floor.
        "p20_below_frequency": round(float((actual < output.p20.to_numpy()).mean()), 4),
        "p50_below_frequency": round(float((actual < output.p50.to_numpy()).mean()), 4),
        "p80_below_frequency": round(float((actual < output.p80.to_numpy()).mean()), 4),
        "p20_at_or_below_frequency": round(float((actual <= output.p20.to_numpy()).mean()), 4),
        "p80_at_or_below_frequency": round(float((actual <= output.p80.to_numpy()).mean()), 4),
        "zero_outcome_frequency": round(float((actual == 0).mean()), 4),
        "p20_p80_coverage": round(float(((actual >= output.p20.to_numpy()) & (actual <= output.p80.to_numpy())).mean()), 4),
        "pinball_p20": round(_pinball(actual, output.p20.to_numpy(), 0.2), 4),
        "pinball_p50": round(_pinball(actual, output.p50.to_numpy(), 0.5), 4),
        "pinball_p80": round(_pinball(actual, output.p80.to_numpy(), 0.8), 4),
    }


def confidence_report(frame: pd.DataFrame, prediction: str) -> dict[str, object]:
    games = _numeric_column(frame, "career_games_before", default=0).fillna(0)
    stable = _numeric_column(frame, "snap_pct_last_1").sub(
        _numeric_column(frame, "snap_pct_last_3")
    ).abs().le(0.10)
    bucket = pd.Series("low", index=frame.index)
    bucket.loc[games.ge(4)] = "medium"
    bucket.loc[games.ge(17) & stable.fillna(False)] = "high"
    return {
        name: regression_metrics(group[ACTUAL_COLUMN].to_numpy(), group[prediction].to_numpy())
        for name, group in frame.assign(_confidence=bucket).groupby("_confidence")
    }


def _confidence_features(frame: pd.DataFrame, prediction: str) -> pd.DataFrame:
    games = _numeric_column(frame, "career_games_before", default=0).fillna(0)
    snap_change = _numeric_column(frame, "snap_pct_last_1").sub(
        _numeric_column(frame, "snap_pct_last_3")
    ).abs()
    return pd.DataFrame({
        "position": frame["historical_position"].fillna("UNK"),
        "projection_band": pd.cut(
            _numeric_column(frame, prediction),
            [-math.inf, 5, 10, 15, 20, math.inf],
            labels=False,
        ).fillna(-1).astype(int),
        "history_band": pd.cut(games, [-math.inf, 3, 16, math.inf], labels=False).fillna(0).astype(int),
        "stable_role": snap_change.le(0.10).fillna(False).astype(int),
    }, index=frame.index)


def chronological_empirical_confidence(frame: pd.DataFrame, prediction: str) -> dict[str, object]:
    """Estimate expected error using prior folds, then assign confidence by risk tercile."""
    evaluated: list[pd.DataFrame] = []
    keys = ["position", "projection_band", "history_band", "stable_role"]
    for year in sorted(frame.season.dropna().unique()):
        calibration = frame.loc[frame.season.lt(year)].dropna(subset=[ACTUAL_COLUMN, prediction]).copy()
        validation = frame.loc[frame.season.eq(year)].dropna(subset=[ACTUAL_COLUMN, prediction]).copy()
        if len(calibration) < 200 or validation.empty:
            continue
        calibration = pd.concat([calibration, _confidence_features(calibration, prediction)], axis=1)
        validation = pd.concat([validation, _confidence_features(validation, prediction)], axis=1)
        calibration["_absolute_error"] = (calibration[ACTUAL_COLUMN] - calibration[prediction]).abs()
        global_error = float(calibration["_absolute_error"].mean())
        grouped = calibration.groupby(keys, observed=True)["_absolute_error"].agg(["sum", "count"])
        grouped["expected_error"] = (grouped["sum"] + 40 * global_error) / (grouped["count"] + 40)
        validation = validation.join(grouped["expected_error"], on=keys)
        validation["expected_error"] = validation["expected_error"].fillna(global_error)
        lower, upper = validation["expected_error"].quantile([1 / 3, 2 / 3])
        validation["_empirical_confidence"] = "medium"
        validation.loc[validation.expected_error.le(lower), "_empirical_confidence"] = "high"
        validation.loc[validation.expected_error.gt(upper), "_empirical_confidence"] = "low"
        evaluated.append(validation)
    if not evaluated:
        return {"rows": 0, "method": "prior-fold empirical absolute-error risk"}
    output = pd.concat(evaluated, ignore_index=True)
    buckets = {
        name: regression_metrics(group[ACTUAL_COLUMN].to_numpy(), group[prediction].to_numpy())
        for name, group in output.groupby("_empirical_confidence")
    }
    high = buckets.get("high", {}).get("mae")
    medium = buckets.get("medium", {}).get("mae")
    low = buckets.get("low", {}).get("mae")
    return {
        "rows": int(len(output)),
        "method": "pregame position/projection/history/role cells fit on prior folds only",
        "buckets": buckets,
        "mae_monotonic": bool(high is not None and medium is not None and low is not None and high <= medium <= low),
    }


def assign_empirical_confidence(
    calibration: pd.DataFrame,
    current: pd.DataFrame,
    prediction: str,
) -> pd.DataFrame:
    """Assign current labels from leakage-safe historical error cells."""
    keys = ["position", "projection_band", "history_band", "stable_role"]
    fitted = calibration.dropna(subset=[ACTUAL_COLUMN, prediction]).copy()
    scored = current.copy()
    fitted = pd.concat([fitted, _confidence_features(fitted, prediction)], axis=1)
    scored = pd.concat([scored, _confidence_features(scored, prediction)], axis=1)
    fitted["_absolute_error"] = (fitted[ACTUAL_COLUMN] - fitted[prediction]).abs()
    global_error = float(fitted["_absolute_error"].mean())
    grouped = fitted.groupby(keys, observed=True)["_absolute_error"].agg(["sum", "count"])
    grouped["expected_error"] = (grouped["sum"] + 40 * global_error) / (grouped["count"] + 40)
    scored = scored.join(grouped["expected_error"], on=keys)
    scored["expected_error"] = scored["expected_error"].fillna(global_error)
    lower, upper = scored["expected_error"].quantile([1 / 3, 2 / 3])
    scored["empirical_confidence"] = "medium"
    scored.loc[scored.expected_error.le(lower), "empirical_confidence"] = "high"
    scored.loc[scored.expected_error.gt(upper), "empirical_confidence"] = "low"
    return scored[["expected_error", "empirical_confidence"]]


def evaluate_model(frame: pd.DataFrame, prediction: str) -> dict[str, object]:
    usable = frame.dropna(subset=[ACTUAL_COLUMN, prediction]).copy()
    return {
        "overall": regression_metrics(usable[ACTUAL_COLUMN].to_numpy(), usable[prediction].to_numpy()),
        "positions": {
            position: regression_metrics(group[ACTUAL_COLUMN].to_numpy(), group[prediction].to_numpy())
            for position, group in usable.groupby("historical_position")
        },
        "role_change": role_change_report(usable, prediction),
        "ranking": ranking_metrics(usable, prediction),
        "quantiles": chronological_quantile_calibration(usable, prediction),
        "confidence": confidence_report(usable, prediction),
        "empirical_confidence": chronological_empirical_confidence(usable, prediction),
        "folds": {
            str(int(season)): regression_metrics(group[ACTUAL_COLUMN].to_numpy(), group[prediction].to_numpy())
            for season, group in usable.groupby("season")
        },
    }
