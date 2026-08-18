export type YahooRaw = Record<string, unknown>;

export interface YahooLeague {
  leagueKey: string;
  name: string;
  season: number;
  numTeams: number | null;
  scoringType: string | null;
  raw: YahooRaw;
}

export interface YahooTeam {
  teamKey: string;
  teamId: string;
  name: string;
  managerId: string | null;
  managerName: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  raw: YahooRaw;
}

export interface YahooRosterPlayer {
  playerKey: string;
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  selectedPosition: string;
  isStarter: boolean;
  raw: YahooRaw;
}

export interface YahooLeagueSettings {
  rosterPositions: string[];
  scoringSettings: Record<string, number>;
  unsupportedScoring: Array<{ statId: string; value: number }>;
  raw: YahooRaw;
}
