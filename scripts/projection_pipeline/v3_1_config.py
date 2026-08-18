from __future__ import annotations

from pathlib import Path

from .config import ROOT

V3_1_VERSION = "v3_1"
V3_1_FEATURE_VERSION = "pbp_features_v1_role_arbitration_v1"
V3_1_ARTIFACT_DIR = ROOT / "artifacts/projections/v3_1"
V3_1_PROJECTION_OUTPUT_PATH = ROOT / "data/processed/player_projections_v3_1.csv"
V3_1_ERROR_REPORT_PATH = ROOT / "data/processed/model_v3_1_error_analysis.csv"
V3_1_EXPERIMENT_REPORT_PATH = ROOT / "data/processed/model_v3_1_experiments.json"
V3_1_COHERENCE_REPORT_PATH = ROOT / "data/processed/model_v3_1_team_coherence.csv"
V3_1_HISTORY_REPORT_PATH = ROOT / "data/processed/model_v3_1_history_buckets.csv"

ENSEMBLE_WEIGHTS = tuple(value / 10 for value in range(11))
BOOTSTRAP_SAMPLES = 2_000
RANDOM_SEED = 42

# Efficiency priors are deliberately ordinary NFL rates. They stabilize sparse
# samples; they do not add opportunity or fantasy points.
EFFICIENCY_PRIORS = {
    "QB": {
        "completion_rate": 0.64,
        "passing_yards_per_attempt": 7.0,
        "passing_td_rate": 0.045,
        "interception_rate": 0.023,
        "rushing_yards_per_attempt": 4.5,
        "rushing_td_rate": 0.035,
    },
    "RB": {
        "rushing_yards_per_attempt": 4.2,
        "rushing_td_rate": 0.030,
        "catch_rate": 0.74,
        "receiving_yards_per_target": 6.2,
        "receiving_td_rate": 0.018,
    },
    "WR": {
        "rushing_yards_per_attempt": 6.0,
        "rushing_td_rate": 0.025,
        "catch_rate": 0.64,
        "receiving_yards_per_target": 7.8,
        "receiving_td_rate": 0.045,
    },
    "TE": {
        "rushing_yards_per_attempt": 4.0,
        "rushing_td_rate": 0.020,
        "catch_rate": 0.67,
        "receiving_yards_per_target": 7.1,
        "receiving_td_rate": 0.050,
    },
}

# Nominal depth is converted to a continuous opportunity prior. Actual recent
# usage can override this signal; these are not fantasy-point multipliers.
DEPTH_OPPORTUNITY_PRIORS = {
    "QB": {1: 0.98, 2: 0.06, 3: 0.015},
    "RB": {1: 0.90, 2: 0.58, 3: 0.23, 4: 0.06},
    "WR": {1: 0.94, 2: 0.84, 3: 0.66, 4: 0.35, 5: 0.15, 6: 0.07},
    "TE": {1: 0.92, 2: 0.38, 3: 0.14, 4: 0.06},
}

ROLE_OPPORTUNITY_MAX = {
    "QB": {1: {"pass_attempts": 44, "rush_attempts": 14}},
    "RB": {
        1: {"rush_attempts": 25, "targets": 10},
        2: {"rush_attempts": 17, "targets": 7},
        3: {"rush_attempts": 10, "targets": 4},
        4: {"rush_attempts": 5, "targets": 2.5},
    },
    "WR": {
        1: {"targets": 14}, 2: {"targets": 12}, 3: {"targets": 10},
        4: {"targets": 7}, 5: {"targets": 4}, 6: {"targets": 2.5},
    },
    "TE": {
        1: {"targets": 12}, 2: {"targets": 6},
        3: {"targets": 3.5}, 4: {"targets": 2},
    },
}

