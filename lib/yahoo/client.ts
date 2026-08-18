import "server-only";
import { getYahooAccessToken } from "./oauth";

const BASE_URL = "https://fantasysports.yahooapis.com/fantasy/v2";

export class YahooFantasyClient {
  constructor(private readonly userId: string) {}

  private async get(path: string) {
    const accessToken = await getYahooAccessToken(this.userId);
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set("format", "json");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (response.status === 401 || response.status === 403) throw new Error("Yahoo authorization expired. Reconnect Yahoo to continue.");
    if (!response.ok) throw new Error(`Yahoo Fantasy API request failed (${response.status}).`);
    return response.json() as Promise<unknown>;
  }

  getLeagues() { return this.get("/users;use_login=1/games;game_codes=nfl/leagues"); }
  getLeague(leagueKey: string) { return this.get(`/league/${encodeURIComponent(leagueKey)}`); }
  getLeagueSettings(leagueKey: string) { return this.get(`/league/${encodeURIComponent(leagueKey)}/settings`); }
  getLeagueTeams(leagueKey: string) { return this.get(`/league/${encodeURIComponent(leagueKey)}/teams`); }
  getTeamRoster(teamKey: string) { return this.get(`/team/${encodeURIComponent(teamKey)}/roster`); }
}
