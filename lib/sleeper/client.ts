import type { SleeperLeague, SleeperPlayer, SleeperRoster, SleeperUser } from "./types";

const BASE_URL = "https://api.sleeper.app/v1";
async function request<T>(path: string): Promise<T> { const response = await fetch(`${BASE_URL}${path}`, { next: { revalidate: 3600 } }); if (!response.ok) throw new Error(`Sleeper request failed (${response.status}) for ${path}`); return response.json() as Promise<T>; }
export const sleeperClient = {
  getUser: (username: string) => request<SleeperUser | null>(`/user/${encodeURIComponent(username)}`),
  getUserLeagues: (userId: string, season: number) => request<SleeperLeague[]>(`/user/${userId}/leagues/nfl/${season}`),
  getLeague: (leagueId: string) => request<SleeperLeague>(`/league/${leagueId}`),
  getLeagueUsers: (leagueId: string) => request<SleeperUser[]>(`/league/${leagueId}/users`),
  getRosters: (leagueId: string) => request<SleeperRoster[]>(`/league/${leagueId}/rosters`),
  getMatchups: (leagueId: string, week: number) => request<unknown[]>(`/league/${leagueId}/matchups/${week}`),
  getTransactions: (leagueId: string, week: number) => request<unknown[]>(`/league/${leagueId}/transactions/${week}`),
  getPlayers: () => request<Record<string, SleeperPlayer>>("/players/nfl")
};
