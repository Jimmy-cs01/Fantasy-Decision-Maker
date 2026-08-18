export interface PlayerWeeklyStats { externalPlayerId: string; season: number; week: number; stats: Record<string, number>; provider: string; }
export interface NFLDataProvider { getWeeklyPlayerStats(season: number, week: number): Promise<PlayerWeeklyStats[]>; }
export interface MatchupContext { opponent: string; isHome: boolean; kickoff: string | null; teamImpliedTotal: number | null; opponentImpliedTotal: number | null; spread: number | null; gameTotal: number | null; }
