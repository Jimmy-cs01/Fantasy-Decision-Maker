from __future__ import annotations

from .config import ROOT

V3_2_VERSION = "v3_2"
V3_2_FEATURE_VERSION = "pbp_snaps_features_v2"
V3_2_ARTIFACT_DIR = ROOT / "artifacts/projections/v3_2"
V3_2_FEATURE_DATASET_PATH = ROOT / "data/processed/player_week_projection_features_v3_2.csv.gz"
V3_2_PROJECTION_OUTPUT_PATH = ROOT / "data/processed/player_projections_v3_2.csv"
V3_2_EXPERIMENT_REPORT_PATH = ROOT / "data/processed/model_v3_2_report.json"
V3_2_COMPARISON_PATH = ROOT / "data/processed/model_v3_2_comparison.csv"
SNAP_WEEKLY_PATH = ROOT / "data/processed/player_weekly_snap_statistics.csv.gz"

ROLLING_FOLDS = (
    (2021, 2022),
    (2022, 2023),
    (2023, 2024),
    (2024, 2025),
)

BASE_SNAP_FEATURES = (
    "snap_pct_last_1",
    "snap_pct_last_3",
    "snap_pct_last_5",
    "snap_games_last_3",
    "snap_games_last_5",
    "snap_history_available",
)

SNAP_TREND_FEATURES = (
    "snap_pct_delta_1",
    "snap_pct_trend_3",
)

SNAP_RATE_FEATURES = (
    "rush_attempts_per_snap_last_3",
    "targets_per_snap_last_3",
    "touches_per_snap_last_3",
)

SNAP_GROUP_FEATURES = (
    "position_group_snap_share_last_1",
    "position_group_snap_share_last_3",
)

SNAP_EXPERIMENTS = {
    "A_v3_1_baseline": (),
    "B_previous_snap": ("snap_pct_last_1", "snap_history_available"),
    "C_previous_rolling3": (
        "snap_pct_last_1", "snap_pct_last_3", "snap_games_last_3", "snap_history_available",
    ),
    "D_previous_rolling3_rolling5": BASE_SNAP_FEATURES,
    "E_D_plus_trend": (*BASE_SNAP_FEATURES, *SNAP_TREND_FEATURES),
    "F_D_plus_rates": (*BASE_SNAP_FEATURES, *SNAP_RATE_FEATURES),
    "G_D_plus_position_group": (*BASE_SNAP_FEATURES, *SNAP_GROUP_FEATURES),
    "H_all_controlled": (
        *BASE_SNAP_FEATURES, *SNAP_TREND_FEATURES, *SNAP_RATE_FEATURES, *SNAP_GROUP_FEATURES,
    ),
}

ENSEMBLE_WEIGHTS = tuple(value / 10 for value in range(11))
RANDOM_SEED = 42
BOOTSTRAP_SAMPLES = 2_000

