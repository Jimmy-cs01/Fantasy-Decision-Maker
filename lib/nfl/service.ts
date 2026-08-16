import type { NFLDataProvider } from "./types";
export async function ingestWeeklyStats(provider: NFLDataProvider, season: number, week: number) { return provider.getWeeklyPlayerStats(season, week); }
