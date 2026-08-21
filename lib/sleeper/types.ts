export interface SleeperUser { user_id: string; username: string; display_name?: string; avatar?: string }
export interface SleeperLeague { league_id: string; name: string; season: string; season_type?: string; status?: string; sport: string; total_rosters?: number; scoring_settings?: Record<string, number>; roster_positions?: string[]; settings?: { playoff_teams?: number; playoff_week_start?: number; leg?: number; [key: string]: unknown } }
export interface SleeperRoster { roster_id: number; owner_id?: string; players?: string[]; starters?: Array<string | null>; reserve?: string[]; settings?: { wins?: number; losses?: number; ties?: number }; metadata?: { team_name?: string } }
export interface SleeperPlayer {
  player_id: string; full_name?: string; first_name?: string; last_name?: string;
  position?: string; team?: string; status?: string;
  injury_status?: string | null; injury_start_date?: string | null;
  injury_body_part?: string | null; injury_notes?: string | null;
  practice_participation?: string | null; practice_description?: string | null;
}
export interface SleeperMatchup { roster_id: number; matchup_id: number | null; points?: number; custom_points?: number | null; players?: string[]; starters?: string[] }
