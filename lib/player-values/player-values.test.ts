import { describe, expect, it } from "vitest";
import { calculatePlayerValues } from "./calculate";
import { CMC_2019_RAW_VALUE, historicalCmc2019AnchorValue, normalizePlayerValue, playerValueTier } from "./formula";
import { optimizeProjectedLineup } from "./lineup";
import { priorInfluence, scoreProjectionPool, stabilizeProjection, type ValueProjectionRecord } from "./projections";
import { calculatePositionDemand, calculateReplacementProfiles } from "./replacement";
import type { FantasyPosition, ValueLeagueConfig, ValuePlayerProjection } from "./types";

const player = (playerId: string, position: FantasyPosition, projectedPpg: number): ValuePlayerProjection => ({
  playerId, fullName: playerId, position, projectedPpg,
  floorPpg: Math.max(0, projectedPpg - 5), ceilingPpg: projectedPpg + 6, confidence: "high",
});

const pool = () => (["QB", "RB", "WR", "TE"] as FantasyPosition[]).flatMap((position) =>
  Array.from({ length: 70 }, (_, index) => player(`${position}-${index + 1}`, position, 30 - index * 0.35)),
);

const config = (teams: number, rosterPositions: string[], rec = 0.5): ValueLeagueConfig => ({ teams, rosterPositions, scoringSettings: { rec } });

describe("Player Value foundation", () => {
  it("permanently anchors 2019 Christian McCaffrey at exactly 100", () => {
    expect(CMC_2019_RAW_VALUE).toBeGreaterThan(0);
    expect(CMC_2019_RAW_VALUE).toBeCloseTo(315.228, 3);
    expect(historicalCmc2019AnchorValue()).toBe(100);
    expect(normalizePlayerValue(CMC_2019_RAW_VALUE)).toBe(99.9);
    expect(normalizePlayerValue(CMC_2019_RAW_VALUE * 10)).toBe(99.9);
  });

  it("never produces a displayed value outside 0–100", () => {
    expect(normalizePlayerValue(-500)).toBe(0);
    expect(normalizePlayerValue(Number.MAX_VALUE)).toBe(99.9);
  });

  it("uses a monotonic nonlinear display calibration without moving the CMC anchor", () => {
    expect(normalizePlayerValue(CMC_2019_RAW_VALUE * 0.1)).toBeCloseTo(39.8, 1);
    expect(normalizePlayerValue(CMC_2019_RAW_VALUE * 0.25)).toBeCloseTo(57.4, 1);
    expect(normalizePlayerValue(CMC_2019_RAW_VALUE * 0.5)).toBeCloseTo(75.8, 1);
    expect(normalizePlayerValue(CMC_2019_RAW_VALUE * 0.1))
      .toBeLessThan(normalizePlayerValue(CMC_2019_RAW_VALUE * 0.25));
  });

  it("stabilizes proven Week 1 players and decays the prior as current games accumulate", () => {
    const preseason = stabilizeProjection(7, { ppg: 15, games: 16, currentSeasonGames: 0 });
    const weekFive = stabilizeProjection(7, { ppg: 15, games: 16, currentSeasonGames: 4 });
    const mature = stabilizeProjection(7, { ppg: 15, games: 16, currentSeasonGames: 8 });
    expect(preseason.ppg).toBeGreaterThan(weekFive.ppg);
    expect(weekFive.ppg).toBeGreaterThan(mature.ppg);
    expect(mature.ppg).toBe(7);
    expect(priorInfluence(0)).toBeCloseTo(0.2);
  });

  it("does not invent a historical prior for a rookie or a missing projection", () => {
    expect(stabilizeProjection(12, { ppg: 20, games: 2, currentSeasonGames: 0 }).ppg).toBe(12);
    expect(stabilizeProjection(12, undefined).ppg).toBe(12);
  });

  it("moves replacement level when league size changes", () => {
    const players = pool();
    const small = calculateReplacementProfiles(players, config(8, ["QB", "RB", "RB", "WR", "WR", "TE"]));
    const large = calculateReplacementProfiles(players, config(14, ["QB", "RB", "RB", "WR", "WR", "TE"]));
    expect(large.RB.demandedPlayers).toBeGreaterThan(small.RB.demandedPlayers);
    expect(large.RB.replacementPpg).toBeLessThan(small.RB.replacementPpg);
  });

  it("allocates FLEX demand only to RB/WR/TE", () => {
    const players = pool();
    const base = calculatePositionDemand(players, config(10, ["QB", "RB", "WR", "TE"]));
    const flex = calculatePositionDemand(players, config(10, ["QB", "RB", "WR", "TE", "FLEX", "FLEX"]));
    expect(flex.QB).toBe(base.QB);
    expect(flex.RB + flex.WR + flex.TE).toBe(base.RB + base.WR + base.TE + 20);
  });

  it("makes QB replacement and value materially different in Superflex", () => {
    const players = pool();
    const oneQb = calculatePlayerValues(players, config(12, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]), 1);
    const superflex = calculatePlayerValues(players, config(12, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"]), 1);
    const oneQbValue = oneQb.values.find((value) => value.playerId === "QB-5")!;
    const superflexValue = superflex.values.find((value) => value.playerId === "QB-5")!;
    expect(superflex.profiles.QB.demandedPlayers).toBeGreaterThan(oneQb.profiles.QB.demandedPlayers);
    expect(superflexValue.value).toBeGreaterThan(oneQbValue.value);
  });

  it("lets league scoring change pass-catcher PPG without another projection", () => {
    const record = projectionRecord("rookie", "WR", { receptions: 8, receiving_yards: 80, receiving_touchdowns: 0.5 });
    const half = scoreProjectionPool([record], { rec: 0.5 })[0];
    const ppr = scoreProjectionPool([record], { rec: 1 })[0];
    expect(ppr.projectedPpg - half.projectedPpg).toBe(4);
  });

  it("makes reception-heavy players more valuable in PPR than Half PPR", () => {
    const records = (["QB", "RB", "WR", "TE"] as FantasyPosition[]).flatMap((position) => Array.from({ length: 35 }, (_, index) =>
      projectionRecord(`${position}-${index}`, position, position === "WR"
        ? { receptions: index === 0 ? 10 : 3, receiving_yards: 70 - index, receiving_touchdowns: 0.3 }
        : position === "QB" ? { passing_yards: 220 - index, passing_touchdowns: 1.5 }
          : { rush_attempts: 10, rushing_yards: 45 - index * 0.5, receptions: 2, receiving_yards: 15 }),
    ));
    const league = config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]);
    const half = calculatePlayerValues(scoreProjectionPool(records, { rec: 0.5 }), league, 1).values.find((item) => item.playerId === "WR-0")!;
    const ppr = calculatePlayerValues(scoreProjectionPool(records, { rec: 1 }), { ...league, scoringSettings: { rec: 1 } }, 1).values.find((item) => item.playerId === "WR-0")!;
    expect(ppr.value).toBeGreaterThan(half.value);
  });

  it("values a rookie from a projection alone and handles an absent projection", () => {
    const players = [player("rookie", "WR", 32), ...pool()];
    const values = calculatePlayerValues(players, config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX"]), 1).values;
    expect(values.find((value) => value.playerId === "rookie")?.value).toBeGreaterThan(0);
    expect(values.find((value) => value.playerId === "missing")).toBeUndefined();
  });

  it("calculates VORP, ROS VORP, deterministic ranks, and tiers", () => {
    const players = pool();
    const first = calculatePlayerValues(players, config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX"]), 1);
    const second = calculatePlayerValues(players, config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX"]), 1);
    const leader = first.values[0];
    expect(leader.rosVorp).toBeCloseTo(leader.vorpPerGame * 17, 1);
    expect(leader.overallRank).toBe(1);
    expect(leader.floorValue).toBeLessThanOrEqual(leader.medianValue);
    expect(leader.ceilingValue).toBeGreaterThanOrEqual(leader.medianValue);
    expect(first.values.filter((value) => value.position === "RB").map((value) => value.positionRank).slice(0, 3)).toEqual([1, 2, 3]);
    expect(first.values).toEqual(second.values);
    expect(playerValueTier(84)).toBe("Elite Fantasy Asset");
    expect(playerValueTier(4)).toBe("Replacement / Waiver");
  });
});

describe("optimal projected lineup", () => {
  const roster = [
    { playerId: "qb1", position: "QB", projectedPpg: 20 },
    { playerId: "qb2", position: "QB", projectedPpg: 18 },
    { playerId: "rb1", position: "RB", projectedPpg: 16 },
    { playerId: "rb2", position: "RB", projectedPpg: 12 },
    { playerId: "wr1", position: "WR", projectedPpg: 15 },
    { playerId: "wr2", position: "WR", projectedPpg: 10 },
    { playerId: "te1", position: "TE", projectedPpg: 9 },
    { playerId: "bench", position: "RB", projectedPpg: 14 },
    { playerId: "missing", position: "WR", projectedPpg: null },
  ];

  it("fills FLEX and Superflex with the best eligible combination and excludes unused bench players", () => {
    const result = optimizeProjectedLineup(roster, ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"]);
    expect(result.complete).toBe(true);
    expect(result.selectedPlayerIds).toContain("qb2");
    expect(result.selectedPlayerIds).toContain("bench");
    expect(result.selectedPlayerIds).not.toContain("rb2");
    expect(result.selectedPlayerIds).not.toContain("missing");
    expect(result.projectedPpg).toBe(92);
  });

  it("is deterministic and marks missing starter projections incomplete", () => {
    const slots = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];
    const first = optimizeProjectedLineup(roster.slice(0, 4), slots);
    const second = optimizeProjectedLineup(roster.slice(0, 4).reverse(), slots);
    expect(first).toEqual(second);
    expect(first.complete).toBe(false);
  });
});

function projectionRecord(playerId: string, position: string, stats: ValueProjectionRecord["projected_stats"]): ValueProjectionRecord {
  return {
    player_id: playerId, season: 2026, week: 1, projected_stats: stats,
    residual_low: -5, residual_high: 7, confidence: "medium",
    players: { id: playerId, full_name: playerId, position, sleeper_position: position, historical_position: position, team: null, headshot_url: null, sleeper_player_id: null },
  };
}
