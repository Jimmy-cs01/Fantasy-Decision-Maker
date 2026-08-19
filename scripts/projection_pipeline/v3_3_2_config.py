from __future__ import annotations

from .config import ROOT


V3_3_2_VERSION = "v3.3.2"
V3_3_2_FEATURE_VERSION = "pbp_snaps_features_v2_passing_hierarchy_v1"
V3_3_2_ARTIFACT_DIR = ROOT / "artifacts/projections/v3_3_2"
V3_3_2_REPORT_PATH = ROOT / "data/processed/model_v3_3_2_report.json"
V3_3_2_FORENSICS_PATH = ROOT / "data/processed/model_v3_3_2_team_forensics.json"
V3_3_2_COMPARISON_PATH = ROOT / "data/processed/model_v3_3_2_comparison.csv"
V3_3_2_PROJECTION_OUTPUT_PATH = ROOT / "data/processed/player_projections_v3_3_2.csv"

# Frozen from 2018-2021 team-week PBP, before every rolling validation fold.
# A target excludes spikes, throwaways and other attempts with no eligible receiver.
TARGETS_PER_PASS_ATTEMPT = 0.911765
MODELED_TARGET_COVERAGE = 0.991322
DIRECT_SAFETY_WEIGHT = 0.40
TAIL_SAFETY_WEIGHT = 0.55
