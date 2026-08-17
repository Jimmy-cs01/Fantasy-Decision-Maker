import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const service = readFileSync(
  new URL("../../../../lib/player-values/league-service.ts", import.meta.url),
  "utf8",
);

describe("league roster query contract", () => {
  it("loads every league roster, player identity, and projection pool in batches", () => {
    expect(service).toContain(
      "players(id,sleeper_player_id,full_name,position,team,headshot_url)",
    );
    expect(service).toContain('.in("fantasy_team_id", teamIds)');
    expect(service).toContain('.in("roster_id", rosterIds)');
    expect(service).toContain(
      "dependencies.getLatestProjectionPool(db, signal)",
    );
    expect(service).toContain("optionalQuery");
    expect(service).toContain("analyticsAvailable");
  });

  it("renders league-scored values, optimal lineup PPG, and the shared player route", () => {
    expect(source).toContain("getLeagueRosterAnalytics");
    expect(source).toContain("<TeamSelector");
    expect(source).toContain("teamId=${team.id}");
    expect(source).toContain("selectedTeamProjection.projectedPpg.toFixed(1)");
    expect(service).toContain("optimizeProjectedLineup");
    expect(service).toContain("player_value");
  });

  it("distinguishes a required roster failure from a genuinely empty synchronized roster", () => {
    expect(source).toContain("rosterLoadFailed");
    expect(source).toContain("Roster data is temporarily unavailable");
    expect(source).toContain("No player data was returned for this roster");
  });
});
