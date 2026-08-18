import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const component = readFileSync(
  new URL("../../components/trades/trade-finder.tsx", import.meta.url),
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
    expect(component).toContain("Specific Player");
    expect(component).toContain("Whole Roster");
    expect(component).toContain("analyticsAvailable");
    expect(component).not.toContain("<select");
    expect(component).toContain("Search name, position, team");
    expect(component).toContain("aria-pressed={selected}");
    expect(component).toContain("evaluateTrade");
    expect(component).toContain("tradeFairnessScore");
    expect(component).toContain("opponentImpact");
    expect(component).toContain("new Set(suggestions.map");
  });

  it("hydrates optional weekly matchup context without changing player value", () => {
    expect(page).toContain("player.opponent");
    expect(page).toContain("player.team_implied_total");
  });

  it("hydrates projected and prior-season PPG in the shared batched league query", () => {
    expect(page).toContain("player.last_season_ppg");
    expect(page).toContain("getLeagueRosterAnalytics");
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
