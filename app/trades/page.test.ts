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
    expect(component).toContain("Auto Finder");
    expect(component).toContain("Find for Player");
    expect(component).toContain("Search Whole Roster");
    expect(component).toContain("analyticsAvailable");
    expect(component).toContain("manual player selection remains");
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
