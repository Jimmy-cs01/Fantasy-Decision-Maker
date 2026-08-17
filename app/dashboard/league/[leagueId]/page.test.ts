import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../../../lib/player-values/league-service.ts", import.meta.url), "utf8");

describe("league roster query contract", () => {
  it("loads every league roster, player identity, and projection pool in batches", () => {
    expect(service).toContain("players(id,sleeper_player_id,full_name,position,team,headshot_url)");
    expect(service).toContain('.in("fantasy_team_id", teamIds)');
    expect(service).toContain('.in("roster_id", rosterIds)');
    expect(service).toContain("getLatestProjectionPool(db)");
  });

  it("renders league-scored values, optimal lineup PPG, and the shared player route", () => {
    expect(source).toContain("getLeagueRosterAnalytics");
    expect(source).toContain("projected PPG");
    expect(service).toContain("optimizeProjectedLineup");
    expect(service).toContain("player_value");
  });
});
