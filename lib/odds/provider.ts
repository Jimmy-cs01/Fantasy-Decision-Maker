import type { OddsGame, PlayerProp } from "./types";

export interface OddsProvider {
  readonly name: string;
  getGames(season: number, week: number): Promise<OddsGame[]>;
  getPlayerProps(season: number, week: number): Promise<PlayerProp[]>;
}

/** Keeps development functional without purchasing or scraping an odds feed. */
export class NoopOddsProvider implements OddsProvider {
  readonly name = "none";
  async getGames(): Promise<OddsGame[]> { return []; }
  async getPlayerProps(): Promise<PlayerProp[]> { return []; }
}

