export interface SleeperUser { user_id: string; username: string; display_name?: string; avatar?: string }
export interface SleeperLeague { league_id: string; name: string; season: string; season_type?: string; status?: string; sport: string; total_rosters?: number; scoring_settings?: Record<string, number>; roster_positions?: string[] }
export interface SleeperRoster { roster_id: number; owner_id?: string; players?: string[]; starters?: string[]; reserve?: string[]; settings?: { wins?: number; losses?: number; ties?: number }; metadata?: { team_name?: string } }
export interface SleeperPlayer { player_id: string; full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string; status?: string }
