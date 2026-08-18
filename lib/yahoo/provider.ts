import type { FantasyProvider } from "@/lib/fantasy/provider";
import { YahooFantasyClient } from "./client";
import { normalizeYahooLeagues } from "./normalize";

export class YahooFantasyProvider implements FantasyProvider {
  private readonly client: YahooFantasyClient;
  constructor(userId: string) { this.client = new YahooFantasyClient(userId); }
  async getLeagues() {
    return normalizeYahooLeagues(await this.client.getLeagues()).map((league) => ({
      externalId: league.leagueKey, name: league.name, season: league.season,
      totalTeams: league.numTeams, provider: "yahoo" as const,
    }));
  }
}
