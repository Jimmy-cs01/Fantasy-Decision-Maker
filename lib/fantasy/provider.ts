export interface FantasyLeagueSummary {
  externalId: string; name: string; season: number; totalTeams: number | null; provider: "sleeper" | "yahoo";
}

export interface FantasyProvider {
  getLeagues(): Promise<FantasyLeagueSummary[]>;
}
