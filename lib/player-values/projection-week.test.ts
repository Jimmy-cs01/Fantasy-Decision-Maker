import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveProjectionPoolWeek } from "./service";

const game = (week: number, kickoff: string) => ({
  week,
  kickoff,
  home_team: "SF",
  away_team: "LAR",
});

describe("Player Value projection-week selection", () => {
  it("uses the actual current schedule week instead of the highest stored horizon week", () => {
    const schedule = [
      game(1, "2026-09-10T00:00:00Z"),
      game(2, "2026-09-17T00:00:00Z"),
      game(17, "2027-01-03T00:00:00Z"),
    ];
    expect(resolveProjectionPoolWeek(schedule, 17, new Date("2026-08-21T20:00:00Z"))).toBe(1);
    expect(resolveProjectionPoolWeek(schedule, 17, new Date("2026-09-11T12:00:00Z"))).toBe(2);
  });

  it("retains the pre-horizon fallback when schedule data is unavailable", () => {
    expect(resolveProjectionPoolWeek([], 4, new Date("2026-10-01T00:00:00Z"))).toBe(4);
  });
});
