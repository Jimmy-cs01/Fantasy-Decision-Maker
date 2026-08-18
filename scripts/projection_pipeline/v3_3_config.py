from __future__ import annotations

from .config import ROOT

V3_3_VERSION = "v3_3"
V3_3_FEATURE_VERSION = "pbp_snaps_features_v2_role_correction_v1"
V3_3_ARTIFACT_DIR = ROOT / "artifacts/projections/v3_3"
V3_3_PROJECTION_OUTPUT_PATH = ROOT / "data/processed/player_projections_v3_3.csv"
V3_3_COMPARISON_PATH = ROOT / "data/processed/model_v3_3_comparison.csv"
V3_3_REPORT_PATH = ROOT / "data/processed/model_v3_3_report.json"

# Frozen using the four rolling pre-2026 validation folds. The values are
# global architecture constants, never player-specific overrides.
RISING_ROLE_SNAP_DELTA = 0.15
DECLINING_ROLE_SNAP_DELTA = -0.15
RISING_ROLE_V3_2_WEIGHT = 0.25
ESTABLISHED_STARTER_MIN_GAMES = 17
ESTABLISHED_STARTER_MIN_SNAP = 0.70
ESTABLISHED_STARTER_MIN_RANK_PERCENTILE = 0.55
ESTABLISHED_STARTER_MAX_DROP = 1.25
SCORING_TOLERANCE = 1e-6

