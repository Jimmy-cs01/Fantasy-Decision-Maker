import { describe, expect, it } from "vitest";
import { aggregateSeasonRows, type WeeklyAggregateInput } from "./aggregate";
import { normalizeSearch, parsePlayerFilters, positionMatches, scoringSortColumn, searchRank } from "./filters";

const base = { pass_attempts: 0, completions: 0, passing_yards: 0, passing_touchdowns: 0, interceptions: 0, rush_attempts: 10, rushing_yards: 50, rushing_touchdowns: 1, targets: 5, receptions: 4, receiving_yards: 40, receiving_touchdowns: 1, offense_snaps: 40, team_offense_snaps: 60, fantasy_points_standard: 10, fantasy_points_half_ppr: 12, fantasy_points_ppr: 14 };
const weeks: WeeklyAggregateInput[] = [{ ...base, season: 2024, season_type: "REG" }, { ...base, season: 2024, season_type: "REG", rush_attempts: 20, rushing_yards: 150, targets: 10, receptions: 6, receiving_yards: 60, offense_snaps: 50, team_offense_snaps: 70, fantasy_points_ppr: 16 }, { ...base, season: 2024, season_type: "POST", rushing_touchdowns: 5 }, { ...base, season: 2023, season_type: "REG", rushing_touchdowns: 9 }];

describe("player explorer defaults and filters", () => {
  it("defines ALL as fantasy positions and FLEX as RB/WR/TE only", () => { expect(["QB", "RB", "WR", "TE"].every((position) => positionMatches(position, "ALL"))).toBe(true); expect(positionMatches("LB", "ALL")).toBe(false); expect(["RB", "WR", "TE"].every((position) => positionMatches(position, "FLEX"))).toBe(true); expect(positionMatches("QB", "FLEX")).toBe(false); });
  it("creates deterministic initial Leaders defaults without interaction", () => { expect(parsePlayerFilters({})).toEqual({ scoring: "ppr", position: "ALL", seasonType: "REG", category: "fantasy", sort: "fantasy_points", page: 1, view: "leaders" }); });
  it("keeps Leaders and All Players independent", () => { expect(parsePlayerFilters({ view: "leaders" }).view).toBe("leaders"); expect(parsePlayerFilters({ view: "all" }).view).toBe("all"); });
  it("switches ranking columns with scoring format", () => { expect(scoringSortColumn("fantasy_points", "standard")).toBe("fantasy_points_standard"); expect(scoringSortColumn("fantasy_ppg", "half_ppr")).toBe("fantasy_points_half_ppr_per_game"); });
  it("normalizes and sensibly ranks search matches", () => { expect(normalizeSearch("Ja'Marr-Chase")).toBe("jamarrchase"); expect(searchRank("James Cook", "james cook", true, 2022)).toBeGreaterThan(searchRank("Dalvin James", "james", false, 2017)); });
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
