import { describe, expect, it } from "vitest";
import { aggregateSeasonRows, type WeeklyAggregateInput } from "./aggregate";
import { formatStatValue, normalizeSearch, parsePlayerFilters, positionColumns, positionMatches, scoringSortColumn, searchRank } from "./filters";

const base = { pass_attempts: 0, completions: 0, passing_yards: 0, passing_touchdowns: 0, interceptions: 0, rush_attempts: 10, rushing_yards: 50, rushing_touchdowns: 1, targets: 5, receptions: 4, receiving_yards: 40, receiving_touchdowns: 1, offense_snaps: 40, team_offense_snaps: 60, fantasy_points_standard: 10, fantasy_points_half_ppr: 12, fantasy_points_ppr: 14 };
const weeks: WeeklyAggregateInput[] = [{ ...base, season: 2024, season_type: "REG" }, { ...base, season: 2024, season_type: "REG", rush_attempts: 20, rushing_yards: 150, targets: 10, receptions: 6, receiving_yards: 60, offense_snaps: 50, team_offense_snaps: 70, fantasy_points_ppr: 16 }, { ...base, season: 2024, season_type: "POST", rushing_touchdowns: 5 }, { ...base, season: 2023, season_type: "REG", rushing_touchdowns: 9 }];

describe("player explorer defaults and filters", () => {
  it("defines ALL as fantasy positions and FLEX as RB/WR/TE only", () => { expect(["QB", "RB", "WR", "TE"].every((position) => positionMatches(position, "ALL"))).toBe(true); expect(positionMatches("LB", "ALL")).toBe(false); expect(["RB", "WR", "TE"].every((position) => positionMatches(position, "FLEX"))).toBe(true); expect(positionMatches("QB", "FLEX")).toBe(false); });
  it("creates deterministic initial Leaders defaults without category state or interaction", () => { expect(parsePlayerFilters({})).toEqual({ scoring: "ppr", position: "ALL", seasonType: "REG", sort: "fantasy_points", page: 1, view: "leaders" }); });
  it("keeps Leaders and All Players independent", () => { expect(parsePlayerFilters({ view: "leaders" }).view).toBe("leaders"); expect(parsePlayerFilters({ view: "all" }).view).toBe("all"); });
  it("switches ranking columns with scoring format", () => { expect(scoringSortColumn("fantasy_points", "standard")).toBe("fantasy_points_standard"); expect(scoringSortColumn("fantasy_ppg", "half_ppr")).toBe("fantasy_points_half_ppr_per_game"); });
  it("resets a sort that is invisible for the selected position", () => { expect(parsePlayerFilters({ position: "WR", sort: "passing_yards" }).sort).toBe("fantasy_points"); expect(parsePlayerFilters({ position: "WR", sort: "receiving_yards" }).sort).toBe("receiving_yards"); });
  it("normalizes and sensibly ranks search matches", () => { expect(normalizeSearch("Ja'Marr-Chase")).toBe("jamarrchase"); expect(searchRank("James Cook", "james cook", true, 2022)).toBeGreaterThan(searchRank("Dalvin James", "james", false, 2017)); });
});

describe("position-aware leaderboard columns", () => {
  const keys = (position: Parameters<typeof positionColumns>[0]) => positionColumns(position, "ppr").map((item) => item.key);
  it("uses QB passing and rushing fields", () => { expect(keys("QB")).toEqual(expect.arrayContaining(["passing_yards", "rushing_yards", "passing_touchdowns", "pass_attempts", "passing_epa", "passing_cpoe"])); expect(keys("QB")).not.toContain("receiving_epa"); });
  it("uses RB rushing, receiving, and touch fields", () => { expect(keys("RB")).toEqual(expect.arrayContaining(["rush_attempts", "rushing_yards", "targets", "receptions", "true_touches", "rushing_epa"])); expect(keys("RB")).not.toContain("passing_yards"); });
  it("uses WR receiving opportunity and nflverse efficiency fields", () => { expect(keys("WR")).toEqual(expect.arrayContaining(["receptions", "receiving_yards", "average_target_share", "average_air_yards_share", "average_wopr", "receiving_epa", "racr"])); });
  it("uses the WR-style receiving grid for TE without WR rushing extras", () => { expect(keys("TE")).toEqual(expect.arrayContaining(["receptions", "receiving_yards", "average_target_share", "receiving_epa", "racr"])); expect(keys("TE")).not.toContain("rushing_yards"); });
  it("uses a mixed skill-position grid for FLEX without QB metrics", () => { expect(keys("FLEX")).toEqual(expect.arrayContaining(["true_touches", "total_yards", "rushing_yards", "receiving_yards", "yards_per_carry", "yards_per_target"])); expect(keys("FLEX")).not.toContain("passing_yards"); });
  it("uses generalized component totals for ALL", () => { expect(keys("ALL")).toEqual(expect.arrayContaining(["total_yards", "passing_yards", "rushing_yards", "receiving_yards", "passing_touchdowns", "rushing_touchdowns", "receiving_touchdowns"])); });
  it("maps every visible header to its typed backend sort field", () => { for (const position of ["ALL", "QB", "RB", "WR", "TE", "FLEX"] as const) for (const item of positionColumns(position, "ppr")) expect(scoringSortColumn(item.sort, "ppr")).toBe(item.key); });
  it("uses scoring-specific FPTS and PPG columns", () => { expect(keys("RB")).toEqual(expect.arrayContaining(["fantasy_points_ppr", "fantasy_points_ppr_per_game"])); expect(positionColumns("RB", "standard").map((item) => item.key)).toEqual(expect.arrayContaining(["fantasy_points_standard", "fantasy_points_standard_per_game"])); });
  it("formats null as a dash without treating a real zero as missing", () => { const snap = positionColumns("QB", "ppr")[0]; expect(formatStatValue(null, snap)).toBe("—"); expect(formatStatValue(0, snap)).toBe("0.0%"); });
});

describe("season aggregation correctness", () => {
  const result = aggregateSeasonRows(weeks, "ppr", 2024, "REG", "RB");
  it("isolates the selected season and excludes postseason", () => { expect(result.gamesPlayed).toBe(2); expect(result.rushingTouchdowns).toBe(2); });
  it("keeps component touchdowns separate", () => { expect(result).toMatchObject({ passingTouchdowns: 0, rushingTouchdowns: 2, receivingTouchdowns: 2, totalTouchdowns: 4 }); });
  it("defines RB total yards as rushing plus receiving", () => { expect(result).toMatchObject({ rushingYards: 200, receivingYards: 100, totalYards: 300 }); });
  it("uses weighted season formulas", () => { expect(result.yardsPerCarry).toBeCloseTo(200 / 30); expect(result.yardsPerTarget).toBeCloseTo(100 / 15); expect(result.yardsPerReception).toBe(10); expect(result.snapShare).toBeCloseTo(90 / 130); });
  it("calculates actual-game PPG and true touches", () => { expect(result).toMatchObject({ fantasyPoints: 30, fantasyPointsPerGame: 15, trueTouches: 40 }); });
  it("defines QB total offense and weighted passing rates", () => { const qb = weeks.slice(0, 2).map((row) => ({ ...row, pass_attempts: 20, completions: 12, passing_yards: 200, passing_touchdowns: 2, interceptions: 1 })); const value = aggregateSeasonRows(qb, "standard", 2024, "REG", "QB"); expect(value).toMatchObject({ totalYards: 600, totalTouchdowns: 6, interceptionsThrown: 2, completionPercentage: 0.6, yardsPerPassAttempt: 10 }); });
});
