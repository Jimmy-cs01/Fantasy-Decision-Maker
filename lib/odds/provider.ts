import type { OddsGame, PlayerProp } from "./types";

export interface OddsProvider {
  readonly name: string;
  getGames(season: number, week: number): Promise<OddsGame[]>;
  getPlayerPropsForEvent(
    eventId: string,
    marketKeys?: readonly string[],
  ): Promise<PlayerProp[]>;
}

/** Keeps development functional without purchasing or scraping an odds feed. */
export class NoopOddsProvider implements OddsProvider {
  readonly name = "none";
  async getGames(): Promise<OddsGame[]> { return []; }
  async getPlayerPropsForEvent(): Promise<PlayerProp[]> { return []; }
}
