import type { NFLDataProvider, PlayerWeeklyStats } from "./types";
export class MockNFLDataProvider implements NFLDataProvider { async getWeeklyPlayerStats(_season: number, _week: number): Promise<PlayerWeeklyStats[]> { return []; } }
