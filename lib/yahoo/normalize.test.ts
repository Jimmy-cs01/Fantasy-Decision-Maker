import { describe, expect, it } from "vitest";
import { normalizeYahooLeagues, normalizeYahooRoster, normalizeYahooSettings, normalizeYahooTeams } from "./normalize";
import { isValidYahooOAuthState } from "./state";
import { parseYahooTokenResponse } from "./token";

describe("Yahoo Fantasy normalization", () => {
  it("validates OAuth state without accepting missing or changed values", () => {
    expect(isValidYahooOAuthState("secure-state", "secure-state")).toBe(true);
    expect(isValidYahooOAuthState("changed", "secure-state")).toBe(false);
    expect(isValidYahooOAuthState(null, "secure-state")).toBe(false);
  });

  it("validates initial and refresh token response shapes", () => {
    expect(parseYahooTokenResponse({ access_token: "access", refresh_token: "refresh", expires_in: 3600, token_type: "bearer" })).toMatchObject({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    expect(parseYahooTokenResponse({ access_token: "renewed", expires_in: 3600, token_type: "bearer" }).refresh_token).toBeUndefined();
    expect(() => parseYahooTokenResponse({ access_token: "", expires_in: 0 })).toThrow("malformed");
  });

  it("discovers leagues in Yahoo's indexed collection shape", () => {
    const payload = { fantasy_content: { users: { 0: { user: [{ guid: "u1" }, { games: { 0: { game: [{ code: "nfl" }, { leagues: { 0: { league: [{ league_key: "449.l.123" }, { name: "Test League", season: "2026", num_teams: 12 }] } } }] } } }] } } } };
    expect(normalizeYahooLeagues(payload)).toMatchObject([{ leagueKey: "449.l.123", name: "Test League", season: 2026, numTeams: 12 }]);
  });

  it("maps common scoring and preserves unsupported rules", () => {
    const payload = { league: [{ settings: [{ roster_positions: [{ roster_position: { position: "QB", count: 1 } }, { roster_position: { position: "W/R/T", count: 2 } }] }, { stat_modifiers: { stats: [{ stat: { stat_id: 4, value: 0.04 } }, { stat: { stat_id: 11, value: 0.5 } }, { stat: { stat_id: 999, value: 2 } }] } }] }] };
    const result = normalizeYahooSettings(payload);
    expect(result.rosterPositions).toEqual(["QB", "FLEX", "FLEX"]);
    expect(result.scoringSettings).toMatchObject({ pass_yd: 0.04, rec: 0.5 });
    expect(result.unsupportedScoring).toEqual([{ statId: "999", value: 2 }]);
  });

  it("normalizes teams, managers, rosters, and selected slots", () => {
    const teams = normalizeYahooTeams({ teams: { 0: { team: [{ team_key: "449.l.1.t.2", team_id: "2", name: "Jimmy's Team" }, { managers: { 0: { manager: { manager_id: "m1", nickname: "Jimmy" } } }, team_standings: { outcome_totals: { wins: 8, losses: 4, ties: 0 } } }] } } });
    expect(teams[0]).toMatchObject({ teamKey: "449.l.1.t.2", managerName: "Jimmy", wins: 8 });
    const roster = normalizeYahooRoster({ roster: { players: { 0: { player: [{ player_key: "449.p.1", player_id: "1" }, { name: { full: "Player One" }, display_position: "RB", editorial_team_abbr: "BUF", selected_position: { position: "W/R/T" } }] } } } });
    expect(roster[0]).toMatchObject({ playerId: "1", name: "Player One", selectedPosition: "FLEX", isStarter: true });
  });
});
