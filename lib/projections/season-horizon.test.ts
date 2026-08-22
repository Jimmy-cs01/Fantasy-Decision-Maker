import { describe, expect, it } from "vitest";
import { buildSeasonProjectionHorizon } from "./season-horizon";
import type { ProjectionRecord } from "./types";

const projection: ProjectionRecord = {
  player_id: "p1", season: 2026, week: 1, season_type: "REG", team: "MIN", opponent_team: "GB",
  projected_stats: { targets: 8, receptions: 6, receiving_yards: 80, receiving_touchdowns: 0.5 },
  model_projection_ppr: 17, vegas_projection_ppr: 18, final_projection_ppr: 17.5,
  projected_points_standard: 11, projected_points_half_ppr: 14, projected_points_ppr: 17,
  residual_low: -6, residual_high: 8, confidence: "high", drivers: ["Current role"],
  model_versions: { version: "v4.1" },
};

const games = Array.from({ length: 17 }, (_, index) => index + 1).filter((week) => week !== 5).map((week) => ({
  week, kickoff: `2026-09-${String(Math.min(28, week + 5)).padStart(2, "0")}T17:00:00Z`, home_team: "MIN", away_team: week === 1 ? "GB" : "CHI",
}));

describe("17-week projection horizon", () => {
  it("returns one efficient season set, zeroes the bye, and strips unsupported future market data", () => {
    const result = buildSeasonProjectionHorizon({ records: [projection], games, context: { mode: "ppr", position: "WR" }, now: new Date("2026-08-21T12:00:00Z") });
    expect(result.rows).toHaveLength(17);
    expect(result.currentWeek).toBe(1);
    expect(result.rows[4]).toMatchObject({ isBye: true, isForecast: true });
    expect(result.rows[4].projection.projectedPoints).toBe(0);
    expect(result.rows[1].projection.vegasProjection).toBeNull();
    expect(result.rows[0].projection.vegasProjection).toBe(18);
  });

  it("uses reported/fallback injury availability without changing active-game talent", () => {
    const result = buildSeasonProjectionHorizon({
      records: [projection], games,
      injury: { player_id: "p1", status: "ir", source: "sleeper", fetched_at: "2026-08-21T12:00:00Z" },
      context: { mode: "ppr", position: "WR" }, now: new Date("2026-08-21T12:00:00Z"),
    });
    expect(result.rows.slice(0, 4).map((row) => row.projection.projectedPoints)).toEqual([0, 0, 0, 0]);
    expect(result.rows[5].projection.projectedPoints).toBe(result.rows[5].projection.activeGameProjectedPoints);
    expect(result.rows[5].projection.projectedPoints).not.toBe(17);
    expect(result.rows[0].projection.activeGameProjectedPoints).toBe(17);
  });

  it("varies a questionable elite RB after a Rams seed matchup and moves its distribution coherently", () => {
    const rb: ProjectionRecord = {
      ...projection,
      player_id: "cmc-style",
      team: "SF",
      opponent_team: "LAR",
      projected_stats: { rush_attempts: 16, rushing_yards: 70, rushing_touchdowns: 0.7, targets: 7, receptions: 5, receiving_yards: 50, receiving_touchdowns: 0.2 },
      residual_low: -3.2,
      residual_high: 5.3,
    };
    const rbGames = Array.from({ length: 17 }, (_, index) => index + 1).filter((week) => week !== 8).map((week) => ({
      week,
      kickoff: `2026-10-${String(Math.min(28, week + 1)).padStart(2, "0")}T17:00:00Z`,
      home_team: "SF",
      away_team: week === 1 ? "LAR" : week === 2 ? "MIA" : week === 4 ? "DEN" : "ARI",
    }));
    const result = buildSeasonProjectionHorizon({
      records: [rb],
      games: rbGames,
      injury: { player_id: "cmc-style", status: "questionable", source: "sleeper", fetched_at: "2026-08-21T12:00:00Z" },
      context: { mode: "ppr", position: "RB" },
      now: new Date("2026-08-21T12:00:00Z"),
    });
    const future = result.rows.filter((row) => !row.isBye && !row.isCurrent);
    const adjustments = future.map((row) => Number(row.projection.diagnostics?.opponentAdjustmentPpg ?? 0));
    expect(adjustments.some((value) => value > 0)).toBe(true);
    expect(adjustments.some((value) => value < 0)).toBe(true);
    expect(new Set(future.map((row) => row.projection.projectedPoints)).size).toBeGreaterThan(1);
    for (const row of future) {
      expect(row.projection.median).toBe(row.projection.projectedPoints);
      expect(row.projection.projectedPoints - row.projection.floor).toBeCloseTo(3.2, 1);
      expect(row.projection.ceiling - row.projection.projectedPoints).toBeCloseTo(5.3, 1);
    }
  });
});
