import { describe, expect, it } from "vitest";
import { scoreProjectionPool } from "./projections";

describe("Player Value projection dependency", () => {
  it("scores the reconciled stat line and never adds Vegas a second time", () => {
    const [projection] = scoreProjectionPool([{ player_id: "p1", season: 2026, week: 1,
      projected_stats: { rush_attempts: 2, rushing_yards: 8, receptions: 0.5, receiving_yards: 3 },
      model_projection_ppr: 16, final_projection_ppr: 1.6, residual_low: -1, residual_high: 2, confidence: "low",
      players: { id: "p1", full_name: "Example Runner", position: "RB", sleeper_position: "RB", historical_position: "RB", team: "BUF", headshot_url: null, sleeper_player_id: "1" } }], { rush_yd: 0.1, rec: 1, rec_yd: 0.1 });
    expect(projection.projectedPpg).toBeCloseTo(1.6, 5);
    expect(projection.projectedPpg).not.toBeCloseTo(17.6, 1);
  });
});
