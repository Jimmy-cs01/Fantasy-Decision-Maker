import { describe, expect, it } from "vitest";
import { applyV4ComponentConsensus, v41SleeperComponentWeight } from "./v4-consensus";

describe("v4 component consensus", () => {
  it("protects a generic established dual-threat QB without a player-name rule", () => {
    const result = applyV4ComponentConsensus({
      position: "QB",
      stats: { rush_attempts: 4, rushing_yards: 20, rushing_touchdowns: 0.1 },
      historical: { games: 80, rushAttempts: 8.5, rushingYards: 55, rushingTouchdowns: 0.3 },
    });
    expect(result.stats.rush_attempts).toBeGreaterThan(4);
    expect(result.stats.rushing_yards).toBeGreaterThan(20);
    expect(result.historicalProtectionApplied).toBe(true);
  });

  it("does not protect a pocket QB or a small historical sample", () => {
    const pocket = applyV4ComponentConsensus({
      position: "QB", stats: { rush_attempts: 2, rushing_yards: 8 },
      historical: { games: 90, rushAttempts: 2.2, rushingYards: 9 },
    });
    const rookie = applyV4ComponentConsensus({
      position: "QB", stats: { rush_attempts: 2, rushing_yards: 8 },
      historical: { games: 3, rushAttempts: 9, rushingYards: 60 },
    });
    expect(pocket.historicalProtectionApplied).toBe(false);
    expect(rookie.historicalProtectionApplied).toBe(false);
  });

  it("uses fresh multi-book props component-by-component and rejects post-kickoff evidence", () => {
    const current = applyV4ComponentConsensus({
      position: "RB", stats: { rush_attempts: 10, rushing_yards: 40 },
      kickoff: "2026-09-01T20:00:00Z", now: new Date("2026-09-01T12:00:00Z"),
      props: [{ market: "player_rush_yds", line: 70, booksReporting: 5, lineStddev: 2, capturedAt: "2026-09-01T10:00:00Z" }],
    });
    const late = applyV4ComponentConsensus({
      position: "RB", stats: { rushing_yards: 40 }, kickoff: "2026-09-01T20:00:00Z",
      now: new Date("2026-09-01T22:00:00Z"),
      props: [{ market: "player_rush_yds", line: 70, booksReporting: 5, capturedAt: "2026-09-01T21:00:00Z" }],
    });
    expect(current.stats.rushing_yards).toBeGreaterThan(40);
    expect(current.stats.rushing_yards).toBeLessThan(70);
    expect(late.stats.rushing_yards).toBe(40);
  });

  it("keeps basic component identities coherent", () => {
    const result = applyV4ComponentConsensus({
      position: "WR", stats: { targets: 5, receptions: 4 },
      sleeper: { targets: 4, receptions: 12 },
    });
    expect(result.stats.receptions).toBeLessThanOrEqual(result.stats.targets ?? 0);
  });

  it("uses a stronger multi-season rushing guard in v4.1", () => {
    const result = applyV4ComponentConsensus({
      release: "v4.1",
      position: "QB",
      stats: { rush_attempts: 4, rushing_yards: 20, rushing_touchdowns: 0.12 },
      historical: { games: 80, seasons: 4, rushAttempts: 8, rushingYards: 52, rushingTouchdowns: 0.3 },
    });
    expect(result.stats.rush_attempts).toBeGreaterThan(6);
    expect(result.stats.rushing_yards).toBeGreaterThan(38);
    expect(result.stats.rushing_touchdowns).toBeGreaterThan(0.2);
  });

  it("increases Sleeper component influence nonlinearly for extreme outliers", () => {
    const close = v41SleeperComponentWeight({ current: 30, sleeper: 32, historicalGames: 30 });
    const extreme = v41SleeperComponentWeight({ current: 20, sleeper: 50, historical: 48, historicalGames: 50 });
    expect(extreme).toBeGreaterThan(close);
    expect(extreme).toBeLessThanOrEqual(0.56);
  });

  it("leaves closely aligned components unchanged", () => {
    expect(v41SleeperComponentWeight({ current: 16.5, sleeper: 16.9, historicalGames: 60 })).toBe(0);
    const result = applyV4ComponentConsensus({
      release: "v4.1", position: "RB", modelPpr: 16.5, sleeperPpr: 16.9,
      stats: { rush_attempts: 18, rushing_yards: 70, targets: 4, receptions: 3 },
      sleeper: { rushAttempts: 12, rushingYards: 50, targets: 7, receptions: 5 },
    });
    expect(result.stats.rush_attempts).toBe(18);
    expect(result.stats.targets).toBe(4);
  });

  it("keeps missing Sleeper components neutral", () => {
    const result = applyV4ComponentConsensus({
      release: "v4.1", position: "WR", stats: { targets: 8, receptions: 5 }, sleeper: {},
    });
    expect(result.stats.targets).toBe(8);
    expect(result.sleeperComponentsUsed).toBe(0);
  });
});
