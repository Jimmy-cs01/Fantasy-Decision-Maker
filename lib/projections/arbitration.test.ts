import { describe, expect, it } from "vitest";
import { arbitrateProjection, calculateVegasProjection } from "./arbitration";

const rbStats = {
  rush_attempts: 10,
  rushing_yards: 48,
  rushing_touchdowns: 1,
  targets: 3.5,
  receptions: 1.6,
  receiving_yards: 16,
  receiving_touchdowns: 0.2,
};
const fresh = "2026-08-17T12:00:00Z";
const now = new Date("2026-08-17T13:00:00Z");

describe("projection arbitration", () => {
  it("dramatically suppresses the no-team RB4 failure archetype", () => {
    const result = arbitrateProjection({
      position: "RB", rawStats: rbStats, modelPpr: 16.4, currentTeam: null,
      depth: { depthRank: 4, isStarter: false, depthPosition: "RB" },
      historicalGames: 0, sleeperPpr: 0.2, now,
    });
    expect(result.finalPpr).toBeLessThan(2);
    expect(result.opportunityConfidence).toBeLessThan(0.1);
    expect(result.confidence).toBe("low");
    expect(result.stats.rush_attempts).toBeLessThan(1);
  });

  it("gates an unproven RB4 without making an established committee RB3 disappear", () => {
    const rb4 = arbitrateProjection({ position: "RB", rawStats: rbStats, modelPpr: 16, currentTeam: "BUF", depth: { depthRank: 4, isStarter: false }, historicalGames: 0, now });
    const committee = arbitrateProjection({ position: "RB", rawStats: rbStats, modelPpr: 16, currentTeam: "BUF", depth: { depthRank: 3, isStarter: false }, historicalGames: 24, recentOpportunityShare: 0.62, now });
    expect(rb4.finalPpr).toBeLessThan(5);
    expect(committee.finalPpr).toBeGreaterThan(6);
  });

  it("allows a promoted backup to receive the full starter projection", () => {
    const result = arbitrateProjection({ position: "QB", rawStats: { pass_attempts: 34, passing_yards: 250, passing_touchdowns: 1.6 }, modelPpr: 17, currentTeam: "BUF", depth: { depthRank: 2, isStarter: true }, now });
    expect(result.opportunityConfidence).toBe(1);
    expect(result.finalPpr).toBeGreaterThan(15);
  });

  it("does not force zero when depth data is missing", () => {
    const result = arbitrateProjection({ position: "WR", rawStats: { targets: 8, receptions: 5, receiving_yards: 70 }, modelPpr: 12, currentTeam: "BUF", historicalGames: 20, now });
    expect(result.finalPpr).toBeGreaterThan(9);
  });

  it("lets strong fresh player props materially move a projection", () => {
    const result = arbitrateProjection({
      position: "RB", rawStats: { ...rbStats, rushing_touchdowns: 0.2 }, modelPpr: 10,
      currentTeam: "BUF", depth: { depthRank: 1, isStarter: true }, now,
      vegasProps: [
        { market: "player_rush_yds", line: 85.5, booksReporting: 8, capturedAt: fresh },
        { market: "player_receptions", line: 4.5, booksReporting: 8, capturedAt: fresh },
        { market: "player_reception_yds", line: 35.5, booksReporting: 8, capturedAt: fresh },
        { market: "player_anytime_td", line: 0.5, overOdds: -140, booksReporting: 8, capturedAt: fresh },
      ],
    });
    expect(result.vegasConfidence).toBeGreaterThan(0.8);
    expect(1 - result.modelWeight).toBeGreaterThan(0.5);
    expect(result.finalPpr).toBeGreaterThan(12);
  });

  it("gives game-only lines modest weight and no Vegas zero weight", () => {
    const gameOnly = calculateVegasProjection({ position: "WR", rawStats: {}, modelPpr: 12, currentTeam: "BUF", vegasGame: { teamImpliedTotal: 28, booksReporting: 8, capturedAt: fresh }, now });
    const absent = calculateVegasProjection({ position: "WR", rawStats: {}, modelPpr: 12, currentTeam: "BUF", now });
    expect(gameOnly.weight).toBeGreaterThanOrEqual(0.05);
    expect(gameOnly.weight).toBeLessThan(0.21);
    expect(absent.weight).toBe(0);
  });

  it("ignores stale Vegas evidence", () => {
    const vegas = calculateVegasProjection({ position: "RB", rawStats: {}, modelPpr: 10, currentTeam: "BUF", now, vegasProps: [{ market: "player_rush_yds", line: 80, booksReporting: 8, capturedAt: "2026-07-01T00:00:00Z" }] });
    expect(vegas.confidence).toBe(0);
  });

  it("uses league reception scoring in the independent Vegas conversion", () => {
    const props = [{ market: "player_receptions", line: 6, booksReporting: 8, capturedAt: fresh }];
    const ppr = calculateVegasProjection({ position: "WR", rawStats: {}, modelPpr: 10, currentTeam: "BUF", vegasProps: props, scoringSettings: { rec: 1 }, now });
    const standard = calculateVegasProjection({ position: "WR", rawStats: {}, modelPpr: 10, currentTeam: "BUF", vegasProps: props, scoringSettings: { rec: 0 }, now });
    expect((ppr.ppr ?? 0) - (standard.ppr ?? 0)).toBeCloseTo(6, 4);
  });

  it("reconciles component scoring to the final projection", () => {
    const result = arbitrateProjection({ position: "RB", rawStats: rbStats, modelPpr: 16.4, currentTeam: "BUF", depth: { depthRank: 4, isStarter: false }, historicalGames: 0, now });
    const score = (result.stats.rushing_yards ?? 0) * 0.1 + (result.stats.rushing_touchdowns ?? 0) * 6 + (result.stats.receptions ?? 0) + (result.stats.receiving_yards ?? 0) * 0.1 + (result.stats.receiving_touchdowns ?? 0) * 6;
    expect(score).toBeCloseTo(result.finalPpr, 1);
  });

  it("uses Sleeper disagreement as independent outlier evidence", () => {
    const result = arbitrateProjection({ position: "RB", rawStats: rbStats, modelPpr: 16.4, currentTeam: "LAR", depth: { depthRank: 4, isStarter: false }, historicalGames: 0, sleeperPpr: 0.2, now });
    expect(["large", "extreme"]).toContain(result.outlierStatus);
    expect(result.finalPpr).toBeLessThan(3);
  });

  it("regresses touchdowns against opportunity volume", () => {
    const result = arbitrateProjection({ position: "RB", rawStats: { rush_attempts: 2, rushing_yards: 8, rushing_touchdowns: 1 }, modelPpr: 6.8, currentTeam: "BUF", depth: { depthRank: 4, isStarter: false }, now });
    expect(result.stats.rushing_touchdowns ?? 0).toBeLessThan(0.03);
  });

  it("preserves an established elite TE1 workload without bypassing projection sanity", () => {
    const result = arbitrateProjection({
      position: "TE",
      rawStats: { targets: 9.5, receptions: 6.8, receiving_yards: 76, receiving_touchdowns: 0.45 },
      modelPpr: 17.1,
      currentTeam: "ARI",
      depth: { depthRank: 1, depthPosition: "TE", isStarter: true },
      historicalGames: 34,
      recentOpportunityShare: 0.31,
      now,
    });
    expect(result.opportunityConfidence).toBe(1);
    expect(result.finalPpr).toBeGreaterThan(16);
  });

  it("does not let old elite history override a current TE3 role", () => {
    const result = arbitrateProjection({
      position: "TE",
      rawStats: { targets: 9.5, receptions: 6.8, receiving_yards: 76, receiving_touchdowns: 0.45 },
      modelPpr: 17.1,
      currentTeam: "ARI",
      depth: { depthRank: 3, depthPosition: "TE", isStarter: false },
      historicalGames: 80,
      recentOpportunityShare: 0.08,
      now,
    });
    expect(result.opportunityConfidence).toBeLessThan(0.5);
    expect(result.finalPpr).toBeLessThan(8);
  });
});
