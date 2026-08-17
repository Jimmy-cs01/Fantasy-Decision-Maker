import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeagueRoster, slotBadgeClass, type LeagueRosterPlayer } from "./league-roster";

const base = {
  position: "RB",
  team: "BAL",
  headshot_url: null,
  roster_slot_index: null,
  projected_ppg: null,
  player_value: null,
  position_rank: null,
  overall_rank: null,
  value_tier: null,
  confidence: null,
} satisfies Partial<LeagueRosterPlayer>;

describe("league roster presentation", () => {
  it("renders starters before a clear bench section with compact PPG", () => {
    const players: LeagueRosterPlayer[] = [
      { ...base, id: "starter", full_name: "Derrick Henry", is_starter: true, roster_slot: "RB", projected_ppg: 18.74, player_value: 88.2, position_rank: 2 } as LeagueRosterPlayer,
      { ...base, id: "bench", full_name: "Bench Player", is_starter: false, roster_slot: "BN" } as LeagueRosterPlayer,
    ];
    const html = renderToStaticMarkup(<LeagueRoster players={players} projectionLabel="2026 W1" leagueId="league-1" />);
    expect(html.indexOf("Derrick Henry")).toBeLessThan(html.indexOf("BENCH"));
    expect(html).toContain("2026 W1 PROJ");
    expect(html).toContain("18.7");
    expect(html).toContain("VALUE 88.2");
    expect(html).toContain("RB2");
    expect(html).toContain('href="/players/starter?scoring=league&amp;leagueId=league-1"');
    expect(html).toContain("Projected PPG unavailable");
  });

  it("uses distinct Sleeper-inspired colors for lineup slots", () => {
    expect(slotBadgeClass("QB")).toContain("pink");
    expect(slotBadgeClass("RB")).toContain("emerald");
    expect(slotBadgeClass("WR")).toContain("sky");
    expect(slotBadgeClass("TE")).toContain("orange");
    expect(slotBadgeClass("FLEX")).toContain("gradient");
  });
});
