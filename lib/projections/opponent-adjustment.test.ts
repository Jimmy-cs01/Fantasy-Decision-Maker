import { describe, expect, it } from "vitest";
import { applyRelativeOpponentAdjustment, opponentStrength } from "./opponent-adjustment";
import type { ProjectionRecord } from "./types";

const record: ProjectionRecord = {
  player_id: "p1", season: 2026, week: 1, season_type: "REG", team: "PHI", opponent_team: "DAL",
  projected_stats: { rush_attempts: 18, rushing_yards: 70, rushing_touchdowns: 0.5, targets: 4, receptions: 3, receiving_yards: 25, receiving_touchdowns: 0.1 },
  model_projection_ppr: 17.5, vegas_projection_ppr: null, final_projection_ppr: 17.5,
  projected_points_standard: 14.5, projected_points_half_ppr: 16, projected_points_ppr: 17.5,
  residual_low: -4, residual_high: 5, confidence: "high", drivers: [], model_versions: { version: "v4.1" },
};

describe("opponent defense adjustment", () => {
  it("uses rank 1 for the hardest matchup and rank 32 for the easiest", () => {
    expect(opponentStrength("RB", "DEN")?.rank).toBe(1);
    expect(opponentStrength("RB", "CIN")?.rank).toBe(32);
  });

  it("decreases a hard matchup, increases a weak matchup, and keeps the seed matchup unchanged", () => {
    const seed = applyRelativeOpponentAdjustment({ record, position: "RB", opponent: "DAL", anchorOpponent: "DAL" });
    const hard = applyRelativeOpponentAdjustment({ record, position: "RB", opponent: "DEN", anchorOpponent: "DAL" });
    const weak = applyRelativeOpponentAdjustment({ record, position: "RB", opponent: "CIN", anchorOpponent: "DAL" });
    expect(seed.projected_points_ppr).toBeCloseTo(16.1, 6);
    expect(hard.projected_points_ppr).toBeLessThan(seed.projected_points_ppr);
    expect(weak.projected_points_ppr).toBeGreaterThan(seed.projected_points_ppr);
    expect(Math.abs(Number(hard.projection_diagnostics?.opponentAdjustmentPpg))).toBeLessThanOrEqual(0.800001);
    expect(Math.abs(Number(weak.projection_diagnostics?.opponentAdjustmentPpg))).toBeLessThanOrEqual(0.800001);
  });

  it("keeps missing matchups neutral", () => {
    const result = applyRelativeOpponentAdjustment({ record, position: "RB", opponent: "UNKNOWN", anchorOpponent: "DAL" });
    expect(result.projected_stats).toEqual(record.projected_stats);
  });

  it("does not apply an already materialized matchup adjustment twice", () => {
    const once = applyRelativeOpponentAdjustment({ record, position: "RB", opponent: "DEN", anchorOpponent: "DAL" });
    const twice = applyRelativeOpponentAdjustment({ record: once, position: "RB", opponent: "DEN", anchorOpponent: "DAL" });
    expect(twice.projected_points_ppr).toBeCloseTo(once.projected_points_ppr, 8);
    expect(twice.projected_stats).toEqual(once.projected_stats);
  });
});
