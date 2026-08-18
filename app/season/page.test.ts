import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("Season Outlook page", () => {
  it("uses league roster analytics and a server-side seeded simulation", () => {
    expect(page).toContain("getLeagueRosterAnalytics");
    expect(page).toContain("simulatePlayoffChances");
    expect(page).toContain("5_000");
  });

  it("labels real provider schedules and documented fallback schedules", () => {
    expect(page).toContain("providerSchedule.length");
    expect(page).toContain("balanced round-robin fallback");
    expect(page).toContain("Divisions and provider-specific tiebreakers are not modeled");
  });
});
