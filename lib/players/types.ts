export type ScoringFormat = "standard" | "half_ppr" | "ppr";
export type PositionFilter = "ALL" | "QB" | "RB" | "WR" | "TE" | "FLEX";
export type SeasonType = "REG" | "POST";
export type LeaderSort = "points" | "ppg" | "yards" | "tds" | "targets" | "touches" | "receptions" | "receiving_yards" | "rushing_yards" | "passing_yards";

export interface PlayerSeasonRow {
  player_id: string; full_name: string; historical_position: string | null; sleeper_position: string | null;
  current_team: string | null; college: string | null; rookie_season: number | null; season: number; season_type: SeasonType;
  games_played: number; pass_attempts: number; completions: number; passing_yards: number; passing_touchdowns: number; interceptions: number; targets: number;
  receptions: number; receiving_yards: number; receiving_air_yards: number; yards_after_catch: number;
  receiving_touchdowns: number; rush_attempts: number; rushing_yards: number; rushing_touchdowns: number;
  touches: number; total_yards: number; total_touchdowns: number; average_snap_percentage: number;
  fantasy_points_standard: number; fantasy_points_half_ppr: number; fantasy_points_ppr: number;
  fantasy_points_standard_per_game: number; fantasy_points_half_ppr_per_game: number; fantasy_points_ppr_per_game: number;
}
