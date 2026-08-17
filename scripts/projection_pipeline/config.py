from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HISTORICAL_STATS_PATH = ROOT / "data/processed/historical_weekly_player_stats.csv"
FEATURE_DATASET_PATH = ROOT / "data/processed/player_week_projection_features.csv"
ARTIFACT_ROOT = ROOT / "artifacts/projections"
PROJECTION_OUTPUT_PATH = ROOT / "data/processed/player_projections.csv"
SCHEDULE_OUTPUT_PATH = ROOT / "data/processed/schedules.csv"
SCHEDULE_SOURCE_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"

FANTASY_POSITIONS = ("QB", "RB", "WR", "TE")
POSITION_CODES = {position: index for index, position in enumerate(FANTASY_POSITIONS)}
ROLLING_WINDOWS = (3, 5, 8)

IDENTITY_COLUMNS = [
    "player_id", "season", "week", "season_type", "game_id", "team",
    "opponent_team", "historical_position",
]

BOX_SCORE_COLUMNS = [
    "pass_attempts", "completions", "passing_yards", "passing_touchdowns",
    "interceptions_thrown", "passing_first_downs", "rush_attempts",
    "rushing_yards", "rushing_touchdowns", "rushing_first_downs", "targets",
    "receptions", "receiving_yards", "receiving_touchdowns",
    "receiving_first_downs", "true_touches", "target_share", "air_yards_share",
    "wopr", "fantasy_points_standard", "fantasy_points_half_ppr",
    "fantasy_points_ppr",
]

REQUIRED_SOURCE_COLUMNS = IDENTITY_COLUMNS + BOX_SCORE_COLUMNS

ROLLING_STATS = [
    "fantasy_points_ppr", "pass_attempts", "completions", "passing_yards",
    "passing_touchdowns", "interceptions_thrown", "rush_attempts",
    "rushing_yards", "rushing_touchdowns", "targets", "receptions",
    "receiving_yards", "receiving_touchdowns", "true_touches", "target_share",
]

FEATURE_COLUMNS = [
    "season", "week", "position_code", "games_played_before", "career_games_before",
    "prior_season_games", "prior_season_ppr_ppg", "prior_season_position_rank_pct",
    "prior_season_rush_attempts_pg", "prior_season_targets_pg",
    "prior_season_receptions_pg", "prior_season_true_touches_pg",
    "has_prior_season", "is_home", "neutral_site", "days_rest", "short_week",
    "long_rest", "returning_from_bye", "is_thursday",
    "fantasy_points_ppr_season_avg", "fantasy_points_ppr_l3",
    "fantasy_points_ppr_l5", "fantasy_points_ppr_l8",
    "pass_attempts_season_avg", "pass_attempts_l3", "pass_attempts_l5",
    "completions_season_avg", "passing_yards_season_avg",
    "passing_touchdowns_season_avg", "interceptions_thrown_season_avg",
    "rush_attempts_season_avg", "rush_attempts_l3", "rush_attempts_l5",
    "rushing_yards_season_avg", "rushing_touchdowns_season_avg",
    "targets_season_avg", "targets_l3", "targets_l5", "receptions_season_avg",
    "receiving_yards_season_avg", "receiving_touchdowns_season_avg",
    "true_touches_season_avg", "true_touches_l3", "true_touches_l5",
    "target_share_season_avg", "target_share_l3", "target_share_l5",
    "completion_percentage_season", "yards_per_pass_attempt_season",
    "passing_td_rate_season", "interception_rate_season",
    "yards_per_carry_season", "yards_per_target_season",
    "yards_per_reception_season", "receiving_td_rate_season",
    "opp_fantasy_points_allowed_season", "opp_fantasy_points_allowed_l3",
    "opp_fantasy_points_allowed_l4",
    "opp_passing_yards_allowed_season", "opp_rushing_yards_allowed_season",
    "opp_receiving_yards_allowed_season", "opp_touchdowns_allowed_season",
    "opp_passing_yards_allowed_l4", "opp_rushing_yards_allowed_l4",
    "opp_receiving_yards_allowed_l4", "opp_passing_tds_allowed_l4",
    "opp_rushing_tds_allowed_l4", "opp_receiving_tds_allowed_l4",
]

DIRECT_TARGET = "fantasy_points_ppr"
STAT_TARGETS_BY_POSITION = {
    "QB": [
        "pass_attempts", "completions", "passing_yards", "passing_touchdowns",
        "interceptions_thrown", "passing_first_downs", "rush_attempts",
        "rushing_yards", "rushing_touchdowns", "rushing_first_downs",
    ],
    "RB": [
        "rush_attempts", "rushing_yards", "rushing_touchdowns",
        "rushing_first_downs", "targets", "receptions", "receiving_yards",
        "receiving_touchdowns", "receiving_first_downs",
    ],
    "WR": [
        "targets", "receptions", "receiving_yards", "receiving_touchdowns",
        "receiving_first_downs", "rush_attempts", "rushing_yards",
        "rushing_touchdowns", "rushing_first_downs",
    ],
    "TE": [
        "targets", "receptions", "receiving_yards", "receiving_touchdowns",
        "receiving_first_downs", "rush_attempts", "rushing_yards",
        "rushing_touchdowns", "rushing_first_downs",
    ],
}
