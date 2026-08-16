import { describe, expect, it } from "vitest";
import { aggregateSeasonRows } from "./aggregate";
import { normalizeSearch, positionMatches, scoringSortColumn, searchRank } from "./filters";

const weeks = [
  { season_type: "REG" as const, fantasy_points_standard: 10, fantasy_points_half_ppr: 12, fantasy_points_ppr: 14, total_yards: 100, total_touchdowns: 1, targets: 6, receptions: 4, touches: 8 },
  { season_type: "REG" as const, fantasy_points_standard: 8, fantasy_points_half_ppr: 10, fantasy_points_ppr: 12, total_yards: 80, total_touchdowns: 0, targets: 5, receptions: 3, touches: 7 },
  { season_type: "POST" as const, fantasy_points_standard: 20, fantasy_points_half_ppr: 20, fantasy_points_ppr: 20, total_yards: 200, total_touchdowns: 2, targets: 8, receptions: 5, touches: 10 },
];

describe("player explorer filters", () => {
  it("defines FLEX as RB, WR, and TE only", () => { expect(["RB", "WR", "TE"].every((position) => positionMatches(position, "FLEX"))).toBe(true); expect(positionMatches("QB", "FLEX")).toBe(false); });
  it("switches ranking columns with scoring format", () => { expect(scoringSortColumn("points", "standard")).toBe("fantasy_points_standard"); expect(scoringSortColumn("ppg", "half_ppr")).toBe("fantasy_points_half_ppr_per_game"); });
  it("normalizes and sensibly ranks search matches", () => { expect(normalizeSearch("Ja'Marr-Chase")).toBe("jamarrchase"); expect(searchRank("James Cook", "james cook", true, 2022)).toBeGreaterThan(searchRank("Dalvin James", "james", false, 2017)); });
});

describe("season aggregation", () => {
  it("calculates actual-game PPG and player detail totals", () => { expect(aggregateSeasonRows(weeks, "ppr", "REG")).toMatchObject({ gamesPlayed: 2, fantasyPoints: 26, fantasyPointsPerGame: 13, totalYards: 180, targets: 11, receptions: 7 }); });
  it("does not mix regular season and postseason", () => { expect(aggregateSeasonRows(weeks, "standard", "POST")).toMatchObject({ gamesPlayed: 1, fantasyPoints: 20, totalYards: 200 }); });
});
