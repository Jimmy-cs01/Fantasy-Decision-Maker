export interface PlayerWeeklyStats { externalPlayerId: string; season: number; week: number; stats: Record<string, number>; provider: string; }
export interface NFLDataProvider { getWeeklyPlayerStats(season: number, week: number): Promise<PlayerWeeklyStats[]>; }
