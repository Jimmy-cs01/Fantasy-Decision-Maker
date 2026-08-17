export interface OddsGame {
  externalGameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeSpread: number | null;
  gameTotal: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  provider: string;
  sportsbook: string;
  capturedAt: string;
}

export interface PlayerProp {
  playerId: string;
  externalGameId: string;
  market: string;
  line: number;
  overOdds: number | null;
  underOdds: number | null;
  provider: string;
  sportsbook: string;
  capturedAt: string;
}

