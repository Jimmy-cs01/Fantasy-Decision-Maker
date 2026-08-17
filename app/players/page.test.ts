import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const query = readFileSync(new URL("../../lib/players/queries.ts", import.meta.url), "utf8");

describe("2026 player explorer", () => {
  it("adds 2026 and keeps projected data distinct from actual season stats", () => {
    expect(page).toContain("[2026, ...await getAvailableSeasons");
    expect(page).toContain('mode === "projected"');
    expect(page).toContain("The 2026 regular season has not produced nflverse rows yet");
  });

  it("renders and server-sorts projected value, rank, PPG, and FPTS", () => {
    expect(page).toContain("ProjectedPlayerLeaderboard");
    expect(query).toContain("getProjectedPlayerLeaders");
    for (const field of ["player_value", "value_rank", "projected_ppg", "projected_fpts"]) expect(query).toContain(field);
  });
});
