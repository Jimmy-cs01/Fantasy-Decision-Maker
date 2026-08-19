import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const component = readFileSync(
  new URL("../../components/trades/trade-finder.tsx", import.meta.url),
  "utf8",
);
const leagueAnalytics = readFileSync(
  new URL("../../lib/player-values/league-service.ts", import.meta.url),
  "utf8",
);
const playerLeaders = readFileSync(
  new URL("../../lib/players/queries.ts", import.meta.url),
  "utf8",
);

describe("Trade Finder route", () => {
  it("uses synchronized league rosters and league-adjusted analytics", () => {
    expect(page).toContain("getLeagueRosterAnalytics");
    expect(page).toContain("rostersByTeam");
    expect(page).toContain("player.player_value");
  });

  it("supports separate manual and automatic modes", () => {
    expect(component).toContain("Manual Trade");
    expect(component).toContain("Find Trades");
    expect(component).not.toContain("Specific Player");
    expect(component).not.toContain('label: "Whole Roster"');
    expect(component).toContain("Find Trades From Whole Roster");
    expect(component).toContain("Players I send");
    expect(component).toContain("Players I receive");
    expect(component).toContain("analyticsAvailable");
    expect(component).not.toContain("<select");
    expect(component).toContain("Search name, position, team");
    expect(component).toContain("aria-pressed={selected}");
    expect(component).toContain("evaluateTrade");
    expect(component).toContain("tradeFairnessScore");
    expect(component).toContain("opponentImpact");
    expect(component).toContain("new Set(");
    expect(component).toContain("suggestions.map((suggestion) => suggestion.opponentTeamId)");
    expect(component).toContain("No trades match these filters");
    expect(component).toContain("lower the minimum quality");
  });

  it("hydrates optional weekly matchup context without changing player value", () => {
    expect(page).toContain("player.opponent");
    expect(page).toContain("player.team_implied_total");
  });

  it("hydrates projected and prior-season PPG in the shared batched league query", () => {
    expect(page).toContain("player.last_season_ppg");
    expect(page).toContain("getLeagueRosterAnalytics");
  });

  it("uses the same active reconciled Player Value projection as the player explorer", () => {
    expect(leagueAnalytics).toContain("getLatestProjectionPool");
    expect(leagueAnalytics).toContain("projected_ppg: playerValue?.projectedPpg ?? null");
    expect(playerLeaders).toContain("const latest = await getLatestProjectionPool(db)");
    expect(playerLeaders).toContain("projected_ppg: value.projectedPpg");
    expect(page).toContain("projectedPpg: player.projected_ppg");
  });

  it("has a route error boundary for required league or roster failures", () => {
    const boundary = readFileSync(
      new URL("./error.tsx", import.meta.url),
      "utf8",
    );
    expect(boundary).toContain("League data is temporarily unavailable");
    expect(boundary).toContain("reset");
  });
});
