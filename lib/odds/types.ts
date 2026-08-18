export interface OddsGame {
  externalGameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  homeSpread: number | null;
  gameTotal: number | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeImpliedTotal: number | null;
  awayImpliedTotal: number | null;
  provider: string;
  sportsbook: string;
  capturedAt: string;
}

export interface PlayerProp {
  playerId?: string;
  playerName: string;
  externalGameId: string;
  market: string;
  line: number;
  overOdds: number | null;
  underOdds: number | null;
  provider: string;
  sportsbook: string;
  capturedAt: string;
}

export interface OddsQuota {
  requestsUsed: number | null;
  requestsRemaining: number | null;
  requestsLast: number | null;
}
