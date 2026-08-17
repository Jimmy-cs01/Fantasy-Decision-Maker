import { describe, expect, it } from "vitest";
import { normalizeProjection } from "./normalize";
import { calculateProjectedFantasyPoints } from "./scoring";
import type { ProjectionRecord } from "./types";

const record: ProjectionRecord = {
  player_id: "player-1", season: 2026, week: 1, season_type: "REG", team: "CIN", opponent_team: "CLE",
  projected_stats: { targets: 8, receptions: 6, receiving_yards: 80, receiving_touchdowns: 0.5 },
  model_projection_ppr: 17, vegas_projection_ppr: null, final_projection_ppr: null,
  projected_points_standard: 11, projected_points_half_ppr: 14, projected_points_ppr: 17,
  residual_low: -6, residual_high: 8, confidence: "medium", drivers: ["Strong recent opportunity volume"],
  model_versions: { version: "v1" },
};

describe("projection scoring and API normalization", () => {
  it("scores the same football line for custom Sleeper reception scoring", () => {
    expect(calculateProjectedFantasyPoints(record.projected_stats, { rec: 0.75 }, "WR")).toBe(15.5);
    expect(calculateProjectedFantasyPoints(record.projected_stats, { rec: 0 }, "WR")).toBe(11);
  });

  it("returns a stable frontend contract and score-relative distribution", () => {
    expect(normalizeProjection(record, { mode: "ppr", position: "WR" })).toMatchObject({
      playerId: "player-1", projectedPoints: 17, floor: 11, median: 17, ceiling: 25,
      stats: { targets: 8, receptions: 6, receivingYards: 80, receivingTouchdowns: 0.5 },
      confidence: "medium", modelVersion: "v1", scoringMode: "ppr",
    });
  });

  it("handles missing Vegas data without changing the statistical projection", () => {
    expect(normalizeProjection(record, { mode: "standard", position: "WR" }).vegasProjection).toBeNull();
  });
});
