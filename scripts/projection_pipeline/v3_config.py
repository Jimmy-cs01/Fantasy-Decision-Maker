from __future__ import annotations

from pathlib import Path

from .config import FEATURE_COLUMNS, FANTASY_POSITIONS, ROOT

PBP_START_SEASON = 2018
PBP_END_SEASON = 2025
PBP_FEATURE_VERSION = "pbp_features_v1"
PBP_SOURCE_TEMPLATE = (
    "https://github.com/nflverse/nflverse-data/releases/download/pbp/"
    "play_by_play_{season}.csv.gz"
)
PBP_RAW_DIR = ROOT / "data/raw/pbp"
PBP_WEEKLY_PATH = ROOT / "data/processed/player_weekly_advanced_statistics.csv.gz"
V3_FEATURE_DATASET_PATH = ROOT / "data/processed/player_week_projection_features_v3.csv.gz"
V3_PROJECTION_OUTPUT_PATH = ROOT / "data/processed/player_projections_v3.csv"
V3_DATA_REPORT_PATH = ROOT / "data/processed/model_v3_data_report.json"
V3_FEATURE_REPORT_PATH = ROOT / "data/processed/model_v3_feature_report.csv"
V3_COMPARISON_PATH = ROOT / "data/processed/model_v3_comparison.csv"

NEUTRAL_SCORE_DIFFERENTIAL = 8
GOAL_LINE_YARDLINE = 2
EXPLOSIVE_RUSH_YARDS = 10
EXPLOSIVE_RECEPTION_YARDS = 20
MODEL_RANDOM_SEED = 42

COMMON_ADVANCED_FEATURES = [
    "team_offensive_plays",
    "team_red_zone_plays",
    "team_goal_to_go_plays",
    "team_pass_rate",
    "team_neutral_pass_rate",
]

POSITION_ADVANCED_FEATURES: dict[str, list[str]] = {
    "QB": [
        "dropbacks", "pbp_pass_attempts", "pbp_completions", "pass_epa_per_dropback",
        "pass_success_rate", "cpoe", "pass_adot", "sack_rate", "designed_rushes",
        "scrambles", "qb_rush_epa_per_attempt", "red_zone_pass_attempts",
        "inside_10_pass_attempts", "goal_to_go_pass_attempts", "red_zone_rushes",
        "goal_line_rushes",
    ],
    "RB": [
        "pbp_rush_attempts", "pbp_targets", "pbp_receptions", "pbp_touches",
        "team_rush_share", "backfield_rush_share", "pbp_target_share",
        "backfield_target_share", "red_zone_carries", "inside_10_carries",
        "inside_5_carries", "goal_line_carries", "red_zone_targets",
        "inside_10_targets", "red_zone_opportunity_share", "goal_line_rush_share",
        "early_down_carries", "third_down_opportunities", "two_minute_opportunities",
        "rush_epa_per_attempt", "rush_success_rate", "explosive_rush_rate",
        "stuffed_rush_rate", "average_opportunity_score_differential",
    ],
    "WR": [
        "pbp_targets", "pbp_receptions", "pbp_target_share", "pbp_air_yards",
        "pbp_air_yards_share", "pbp_adot", "red_zone_targets", "inside_10_targets",
        "end_zone_targets", "first_down_targets", "third_down_targets",
        "two_minute_targets", "target_epa_per_target", "target_success_rate",
        "pbp_yards_after_catch", "yac_per_reception", "explosive_reception_rate",
        "targets_while_trailing",
    ],
    "TE": [
        "pbp_targets", "pbp_receptions", "pbp_target_share", "pbp_air_yards",
        "pbp_air_yards_share", "pbp_adot", "red_zone_targets", "inside_10_targets",
        "end_zone_targets", "first_down_targets", "third_down_targets",
        "two_minute_targets", "target_epa_per_target", "target_success_rate",
        "pbp_yards_after_catch", "yac_per_reception", "explosive_reception_rate",
        "targets_while_trailing",
    ],
}

ADVANCED_ROLLING_WINDOWS = (3, 5, 8)


def advanced_feature_columns(position: str) -> list[str]:
    raw = [*COMMON_ADVANCED_FEATURES, *POSITION_ADVANCED_FEATURES[position]]
    return [
        f"{column}_{suffix}"
        for column in raw
        for suffix in ("season_avg", "l3", "l5", "l8")
    ]


POSITION_BASE_EXCLUSIONS = {
    "QB": {
        "position_code", "yards_per_target_season", "yards_per_reception_season",
        "receiving_td_rate_season",
    },
    "RB": {
        "position_code", "completion_percentage_season", "yards_per_pass_attempt_season",
        "passing_td_rate_season", "interception_rate_season",
    },
    "WR": {
        "position_code", "completion_percentage_season", "yards_per_pass_attempt_season",
        "passing_td_rate_season", "interception_rate_season", "yards_per_carry_season",
    },
    "TE": {
        "position_code", "completion_percentage_season", "yards_per_pass_attempt_season",
        "passing_td_rate_season", "interception_rate_season", "yards_per_carry_season",
    },
}


V3_FEATURE_COLUMNS_BY_POSITION = {
    position: [
        *(feature for feature in FEATURE_COLUMNS if feature not in POSITION_BASE_EXCLUSIONS[position]),
        *advanced_feature_columns(position),
    ]
    for position in FANTASY_POSITIONS
}
