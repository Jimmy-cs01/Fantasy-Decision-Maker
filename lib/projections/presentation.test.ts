import { describe, expect, it } from "vitest";
import { normalizeProjection } from "./normalize";
import { displayedProjectionPoints, projectionScoringLabel } from "./presentation";
import type { ProjectionRecord } from "./types";

const record: ProjectionRecord = {
  player_id: "player-1", season: 2026, week: 1, season_type: "REG", team: "BUF", opponent_team: "NYJ",
  projected_stats: { receptions: 6, receiving_yards: 80, receiving_touchdowns: 0.5 },
  model_projection_ppr: 17, vegas_projection_ppr: null, final_projection_ppr: 17,
  projected_points_standard: 11, projected_points_half_ppr: 14, projected_points_ppr: 17,
  residual_low: -5, residual_high: 6, confidence: "high", drivers: [], model_versions: { version: "v3.3.2" },
};

describe("canonical displayed projection", () => {
  it.each(["standard", "half_ppr", "ppr"] as const)("matches profile normalization for %s", (mode) => {
    const canonical = displayedProjectionPoints({ stats: record.projected_stats, position: "WR", mode });
    expect(normalizeProjection(record, { mode, position: "WR" }).projectedPoints).toBe(Math.round(canonical * 10) / 10);
  });

  it("uses one explicit default label when no league is connected", () => {
    expect(projectionScoringLabel("ppr")).toBe("Jimmy GM default PPR");
    expect(projectionScoringLabel("league", "Home League")).toBe("Home League league scoring");
  });
});
