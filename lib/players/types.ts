export type ScoringFormat = "standard" | "half_ppr" | "ppr" | "league";
export type PositionFilter = "ALL" | "QB" | "RB" | "WR" | "TE" | "FLEX";
export type SeasonType = "REG" | "POST";
export type LeaderSort =
  | "fantasy_points" | "fantasy_ppg" | "total_yards" | "total_touchdowns" | "snap_share" | "true_touches"
  | "pass_attempts" | "completions" | "completion_percentage" | "passing_yards" | "passing_air_yards" | "passing_touchdowns" | "interceptions_thrown" | "yards_per_pass_attempt" | "pass_adot" | "passer_rating" | "passing_td_percentage" | "interception_percentage" | "times_sacked" | "pressure_percentage" | "passing_epa" | "passing_cpoe" | "pacr"
  | "rush_attempts" | "rushing_yards" | "rushing_touchdowns" | "yards_per_carry" | "rushing_td_percentage" | "rush_attempts_red_zone" | "rush_attempts_goal_to_go" | "red_zone_rush_share" | "goal_to_go_rush_share" | "rushing_epa"
  | "targets" | "receptions" | "receiving_yards" | "receiving_touchdowns" | "receiving_air_yards" | "yards_after_catch" | "yards_per_target" | "yards_per_reception" | "receiving_adot" | "yards_after_catch_per_reception" | "receiving_td_percentage" | "receiving_epa" | "racr" | "average_target_share" | "average_air_yards_share" | "average_wopr";

export interface PlayerSeasonRow {
  player_id: string; full_name: string; historical_position: string | null; sleeper_position: string | null;
  headshot_url: string | null;
  current_team: string | null; season_teams: string | null; college: string | null; rookie_season: number | null;
  season: number; season_type: SeasonType; games_played: number;
  pass_attempts: number; completions: number; completion_percentage: number | null; passing_yards: number; passing_air_yards: number;
  passing_touchdowns: number; interceptions_thrown: number; passing_first_downs: number; yards_per_pass_attempt: number | null;
  pass_adot: number | null; passer_rating: number | null; passing_td_percentage: number | null; interception_percentage: number | null;
  times_sacked: number; times_pressured: number | null; pressure_percentage: number | null; passing_epa: number; passing_cpoe: number | null; pacr: number | null;
  rush_attempts: number; rushing_yards: number; rushing_touchdowns: number; rushing_first_downs: number;
  rush_attempts_red_zone: number; rush_attempts_goal_to_go: number; yards_per_carry: number | null;
  rushing_td_percentage: number | null; red_zone_rush_share: number | null; goal_to_go_rush_share: number | null; rushing_epa: number;
  targets: number; receptions: number; receiving_yards: number; receiving_touchdowns: number; receiving_air_yards: number;
  yards_after_catch: number; yards_per_target: number | null; yards_per_reception: number | null; receiving_adot: number | null;
  yards_after_catch_per_reception: number | null; receiving_td_percentage: number | null; receiving_first_downs: number;
  receiving_epa: number; racr: number | null; average_target_share: number | null; average_air_yards_share: number | null; average_wopr: number | null;
  offense_snaps: number | null; team_offense_snaps: number | null; snap_share: number | null; true_touches: number;
  total_yards: number; total_touchdowns: number;
  fantasy_points_standard: number; fantasy_points_half_ppr: number; fantasy_points_ppr: number;
  fantasy_points_standard_per_game: number; fantasy_points_half_ppr_per_game: number; fantasy_points_ppr_per_game: number;
  fantasy_points_league: number | null; fantasy_points_league_per_game: number | null;
}

export interface PlayerExplorerFilters { scoring: ScoringFormat; leagueId: string | null; position: PositionFilter; seasonType: SeasonType; sort: LeaderSort; page: number; view: "leaders" | "all"; }

export interface ScoringLeague {
  id: string;
  name: string;
  season: number;
  scoring_settings: Record<string, number>;
}
