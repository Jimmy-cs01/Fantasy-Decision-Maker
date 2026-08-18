import { describe, expect, it } from "vitest";
import { buildFallbackSchedule, calculatePowerRankings, simulatePlayoffChances, type SeasonTeamInput } from "./outlook";

const team = (id: string, wins: number, projectedPpg: number, rosterValue: number): SeasonTeamInput => ({ id, name: id, wins, losses: 8 - wins, ties: 0, pointsFor: wins * 100, projectedPpg, projectionSd: 18, rosterValue });

describe("season outlook", () => {
  it("normalizes record, lineup strength, roster strength, and schedule context", () => {
    const rankings = calculatePowerRankings([team("lucky", 8, 95, 80), team("strong", 4, 145, 230), team("middle", 5, 120, 140)], []);
    expect(rankings[0].id).toBe("strong");
    expect(rankings.every((row) => row.powerScore >= 0 && row.powerScore <= 100)).toBe(true);
  });

  it("is deterministic, respects playoff-team count, and consumes the supplied schedule", () => {
    const teams = [team("A", 4, 140, 180), team("B", 4, 120, 140), team("C", 4, 105, 110), team("D", 4, 90, 80)];
    const schedule = [{ week: 9, teamAId: "A", teamBId: "D" }, { week: 9, teamAId: "B", teamBId: "C" }];
    const first = simulatePlayoffChances({ teams, schedule, playoffTeams: 2, simulations: 2_000, seed: 17 });
    const second = simulatePlayoffChances({ teams, schedule, playoffTeams: 2, simulations: 2_000, seed: 17 });
    expect(first).toEqual(second);
    expect([...first.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(200, 0);
    expect(first.get("A")).toBeGreaterThan(first.get("D")!);
  });

  it("builds a deterministic balanced fallback when provider schedule settings are missing", () => {
    const schedule = buildFallbackSchedule(["A", "B", "C", "D"], 2, 10);
    expect(schedule).toHaveLength(4);
    expect(new Set(schedule.map((game) => game.week))).toEqual(new Set([10, 11]));
  });

  it("handles ties safely", () => {
    const teams = [{ ...team("A", 3, 110, 100), ties: 1 }, { ...team("B", 3, 110, 100), ties: 1 }];
    const result = simulatePlayoffChances({ teams, schedule: [], playoffTeams: 1, simulations: 100, seed: 1 });
    expect([...result.values()].reduce((sum, value) => sum + value, 0)).toBe(100);
  });
});
