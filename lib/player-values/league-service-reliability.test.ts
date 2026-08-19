import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getEphemeralLeagueRosterAnalytics,
  getLeagueRosterAnalytics,
  type LeagueAnalyticsDependencies,
} from "./league-service";
import type { ValueProjectionRecord } from "./projections";

function queryBuilder(result: {
  data: unknown;
  error: { message: string } | null;
}) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in"]) chain[method] = () => chain;
  chain.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function database(rosterError: { message: string } | null = null) {
  return {
    from: vi.fn((table: string) => {
      if (table === "rosters")
        return queryBuilder({
          data: [
            {
              id: "roster-1",
              fantasy_team_id: "team-1",
              starters: ["sleeper-1"],
            },
          ],
          error: rosterError,
        });
      if (table === "roster_players")
        return queryBuilder({
          data: [
            {
              roster_id: "roster-1",
              is_starter: true,
              roster_slot: "RB",
              roster_slot_index: 0,
              players: {
                id: "player-1",
                sleeper_player_id: "sleeper-1",
                full_name: "Roster Player",
                position: "RB",
                team: "BAL",
                headshot_url: null,
              },
            },
          ],
          error: null,
        });
      throw new Error("Unexpected table " + table);
    }),
  };
}

const league = {
  id: "league-1",
  total_rosters: 10,
  roster_positions: ["RB", "BN"],
  scoring_settings: { rec: 0.5 },
};
const teams = [{ id: "team-1" }];
const record: ValueProjectionRecord = {
  player_id: "player-1",
  season: 2026,
  week: 1,
  projected_stats: {
    rush_attempts: 12,
    rushing_yards: 60,
    receptions: 3,
    receiving_yards: 20,
  },
  residual_low: -4,
  residual_high: 6,
  confidence: "medium",
  players: {
    id: "player-1",
    full_name: "Roster Player",
    position: "RB",
    sleeper_position: "RB",
    historical_position: "RB",
    team: "BAL",
    headshot_url: null,
    sleeper_player_id: "sleeper-1",
  },
};

function dependencies(
  overrides: Partial<LeagueAnalyticsDependencies> = {},
): LeagueAnalyticsDependencies {
  return {
    getLatestProjectionPool: async () => ({
      records: [record],
      season: 2026,
      week: 1,
      modelVersionId: "v2",
    }),
    getProjectionHistoryRows: async () => [],
    getCurrentDepthRoles: async () => new Map(),
    getWeeklyMatchups: async () => [],
    ...overrides,
  };
}

describe("league analytics partial failures", () => {
  it("keeps roster players and calculates values when depth charts fail", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const result = await getLeagueRosterAnalytics(
      database() as never,
      league,
      teams,
      dependencies({
        getCurrentDepthRoles: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );
    expect(
      result.rostersByTeam.get("team-1")?.map((player) => player.full_name),
    ).toEqual(["Roster Player"]);
    expect(result.rostersByTeam.get("team-1")?.[0].player_value).not.toBeNull();
    expect(result.analyticsAvailable).toBe(true);
    warning.mockRestore();
  });

  it("requests optional history and depth in one roster-sized batch", async () => {
    const history = vi.fn<
      LeagueAnalyticsDependencies["getProjectionHistoryRows"]
    >(async () => []);
    const depth = vi.fn<LeagueAnalyticsDependencies["getCurrentDepthRoles"]>(
      async () => new Map(),
    );
    await getLeagueRosterAnalytics(
      database() as never,
      league,
      teams,
      dependencies({
        getProjectionHistoryRows: history,
        getCurrentDepthRoles: depth,
      }),
    );
    expect(history.mock.calls[0][1]).toEqual(["player-1"]);
    expect(depth.mock.calls[0][1]).toEqual(["player-1"]);
  });

  it("keeps roster players and neutral depth when historical PPG fails", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const result = await getLeagueRosterAnalytics(
      database() as never,
      league,
      teams,
      dependencies({
        getProjectionHistoryRows: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );
    expect(result.rostersByTeam.get("team-1")).toHaveLength(1);
    expect(result.rostersByTeam.get("team-1")?.[0].player_value).not.toBeNull();
    expect(result.analyticsAvailable).toBe(true);
    warning.mockRestore();
  });

  it("keeps manual roster data when the projection pool is unavailable", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const result = await getLeagueRosterAnalytics(
      database() as never,
      league,
      teams,
      dependencies({
        getLatestProjectionPool: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );
    expect(result.rostersByTeam.get("team-1")?.[0]).toMatchObject({
      full_name: "Roster Player",
      projected_ppg: null,
      player_value: null,
    });
    expect(result.analyticsAvailable).toBe(false);
    warning.mockRestore();
  });

  it("still rejects a genuinely required roster ownership failure", async () => {
    await expect(
      getLeagueRosterAnalytics(
        database({ message: "permission denied" }) as never,
        league,
        teams,
        dependencies(),
      ),
    ).rejects.toThrow("Unable to load league rosters");
  });

  it("hydrates an ephemeral guest roster without querying saved roster tables", async () => {
    const db = database() as never;
    const result = await getEphemeralLeagueRosterAnalytics(
      db,
      { ...league, id: "guest:league-1" },
      teams,
      [{ id: "guest-roster", fantasy_team_id: "team-1", starters: ["sleeper-1"] }],
      [{
        roster_id: "guest-roster",
        is_starter: true,
        roster_slot: "RB",
        roster_slot_index: 0,
        players: {
          id: "player-1",
          sleeper_player_id: "sleeper-1",
          full_name: "Roster Player",
          position: "RB",
          team: "BAL",
          headshot_url: null,
        },
      }],
      dependencies(),
    );
    expect(result.rostersByTeam.get("team-1")?.[0]).toMatchObject({
      full_name: "Roster Player",
      projected_ppg: expect.any(Number),
      player_value: expect.any(Number),
    });
    expect((db as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});
