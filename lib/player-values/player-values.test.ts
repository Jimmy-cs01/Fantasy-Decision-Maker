import { describe, expect, it } from "vitest";
import { calculatePlayerValues } from "./calculate";
import {
  ageUpsidePpg,
  calculatePlayerValue,
  depthOpportunityFactor,
  depthOpportunityPpg,
  draftCapitalConfidence,
  normalizePlayerValue,
  opportunityConfidence,
  playerValueTier,
} from "./formula";
import { optimizeProjectedLineup } from "./lineup";
import {
  priorInfluence,
  scoreProjectionPool,
  stabilizeProjection,
  type ValueProjectionRecord,
} from "./projections";
import {
  calculatePositionDemand,
  calculateReplacementProfiles,
} from "./replacement";
import type {
  FantasyPosition,
  ValueLeagueConfig,
  ValuePlayerProjection,
} from "./types";

const player = (
  playerId: string,
  position: FantasyPosition,
  projectedPpg: number,
): ValuePlayerProjection => ({
  playerId,
  fullName: playerId,
  position,
  projectedPpg,
  floorPpg: Math.max(0, projectedPpg - 5),
  ceilingPpg: projectedPpg + 6,
  confidence: "high",
});

const pool = () =>
  (["QB", "RB", "WR", "TE"] as FantasyPosition[]).flatMap((position) =>
    Array.from({ length: 70 }, (_, index) =>
      player(`${position}-${index + 1}`, position, 30 - index * 0.35),
    ),
  );

const config = (
  teams: number,
  rosterPositions: string[],
  rec = 0.5,
): ValueLeagueConfig => ({ teams, rosterPositions, scoringSettings: { rec } });

describe("Player Value foundation", () => {
  it("uses a generic historical calibration rather than a hardcoded player anchor", () => {
    expect(normalizePlayerValue(315)).toBeCloseTo(49, 1);
    expect(normalizePlayerValue(450)).toBeGreaterThan(50);
    expect(normalizePlayerValue(450)).toBeLessThan(55);
  });

  it("preserves a small positive value near replacement and approaches zero only far below it", () => {
    expect(normalizePlayerValue(0)).toBeGreaterThan(0);
    expect(normalizePlayerValue(-50)).toBeGreaterThan(0);
    expect(normalizePlayerValue(-1000)).toBe(0);
  });

  it("keeps the display calibration deterministic and monotonic", () => {
    const samples = [-500, -100, 0, 50, 150, 315, 500].map(
      normalizePlayerValue,
    );
    expect(samples).toEqual([...samples].sort((left, right) => left - right));
  });

  it("stabilizes proven Week 1 players and decays the prior as current games accumulate", () => {
    const preseason = stabilizeProjection(7, {
      ppg: 15,
      games: 16,
      currentSeasonGames: 0,
    });
    const weekFive = stabilizeProjection(7, {
      ppg: 15,
      games: 16,
      currentSeasonGames: 4,
    });
    const mature = stabilizeProjection(7, {
      ppg: 15,
      games: 16,
      currentSeasonGames: 8,
    });
    expect(preseason.ppg).toBeGreaterThan(weekFive.ppg);
    expect(weekFive.ppg).toBeGreaterThan(mature.ppg);
    expect(mature.ppg).toBe(7);
    expect(priorInfluence(0)).toBeCloseTo(0.2);
  });

  it("does not invent a historical prior for a rookie or a missing projection", () => {
    expect(
      stabilizeProjection(12, { ppg: 20, games: 2, currentSeasonGames: 0 }).ppg,
    ).toBe(12);
    expect(stabilizeProjection(12, undefined).ppg).toBe(12);
  });

  it("lets current-season games establish opportunity without treating them as a prior", () => {
    const scored = scoreProjectionPool(
      [
        projectionRecord("rookie", "RB", {
          rush_attempts: 10,
          rushing_yards: 45,
        }),
      ],
      { rec: 0.5 },
      new Map([["rookie", { ppg: 0, games: 0, currentSeasonGames: 4 }]]),
    )[0];
    expect(scored.priorWeight).toBe(0);
    expect(scored.historicalGames).toBe(4);
  });

  it("moves replacement level when league size changes", () => {
    const players = pool();
    const small = calculateReplacementProfiles(
      players,
      config(8, ["QB", "RB", "RB", "WR", "WR", "TE"]),
    );
    const large = calculateReplacementProfiles(
      players,
      config(14, ["QB", "RB", "RB", "WR", "WR", "TE"]),
    );
    expect(large.RB.demandedPlayers).toBeGreaterThan(small.RB.demandedPlayers);
    expect(large.RB.replacementPpg).toBeLessThan(small.RB.replacementPpg);
  });

  it("includes bench depth in the roster boundary without changing starter eligibility", () => {
    const players = pool();
    const starters = calculateReplacementProfiles(
      players,
      config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]),
    );
    const deep = calculateReplacementProfiles(
      players,
      config(10, [
        "QB",
        "RB",
        "RB",
        "WR",
        "WR",
        "TE",
        "FLEX",
        "BN",
        "BN",
        "BN",
        "BN",
        "BN",
        "BN",
      ]),
    );
    expect(
      deep.RB.demandedPlayers +
        deep.WR.demandedPlayers +
        deep.TE.demandedPlayers +
        deep.QB.demandedPlayers,
    ).toBe(
      starters.RB.demandedPlayers +
        starters.WR.demandedPlayers +
        starters.TE.demandedPlayers +
        starters.QB.demandedPlayers +
        60,
    );
    expect(deep.RB.replacementPpg).toBeLessThanOrEqual(
      starters.RB.replacementPpg,
    );
  });

  it("moderately favors younger comparable players without changing projected PPG", () => {
    const young = {
      ...player("young", "RB", 12),
      season: 2026,
      birthDate: "2003-01-01",
    };
    const old = {
      ...player("old", "RB", 12),
      season: 2026,
      birthDate: "1995-01-01",
    };
    expect(ageUpsidePpg(young)).toBeGreaterThan(ageUpsidePpg(old));
    expect(young.projectedPpg).toBe(old.projectedPpg);
  });

  it("uses depth as a moderate context signal and does not make young backups worthless", () => {
    const profile = {
      ...calculateReplacementProfiles(
        pool(),
        config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]),
      ).RB,
    };
    const starter = {
      ...player("starter", "RB", 12),
      season: 2026,
      birthDate: "2002-01-01",
      depthRank: 1,
    };
    const backup = { ...starter, playerId: "backup", depthRank: 2 };
    expect(depthOpportunityPpg(starter, profile)).toBeGreaterThan(
      depthOpportunityPpg(backup, profile),
    );
    expect(depthOpportunityPpg(backup, profile)).toBeGreaterThanOrEqual(0);
  });

  it("gates young-player upside with draft capital and actual depth-chart access", () => {
    const profile = {
      position: "RB" as const,
      demandedPlayers: 36,
      replacementPpg: 7.4,
      starterPpg: 12,
      elitePpg: 18,
      scarcityDropoff: 10.6,
      demandPerTeam: 3.6,
    };
    const archetype = {
      ...player("rookie", "RB", 16),
      season: 2026,
      floorPpg: 12,
      ceilingPpg: 24,
      birthDate: "2003-01-01",
      historicalGames: 0,
    };
    const roundOneRb1 = {
      ...archetype,
      playerId: "round-1-rb1",
      draftStatus: "drafted" as const,
      draftRound: 1,
      depthRank: 1,
    };
    const roundTwoRb2 = {
      ...archetype,
      playerId: "round-2-rb2",
      draftStatus: "drafted" as const,
      draftRound: 2,
      depthRank: 2,
    };
    const roundFourRb3 = {
      ...archetype,
      playerId: "round-4-rb3",
      draftStatus: "drafted" as const,
      draftRound: 4,
      depthRank: 3,
    };
    const roundSevenRb4 = {
      ...archetype,
      playerId: "round-7-rb4",
      draftStatus: "drafted" as const,
      draftRound: 7,
      depthRank: 4,
    };
    const udfaRb4 = {
      ...archetype,
      playerId: "udfa-rb4",
      draftStatus: "undrafted" as const,
      draftRound: null,
      depthRank: 4,
    };
    const values = [
      roundOneRb1,
      roundTwoRb2,
      roundFourRb3,
      roundSevenRb4,
      udfaRb4,
    ].map((item) => calculatePlayerValue(item, profile, 17));
    expect(values.map((item) => item.value)).toEqual(
      [...values.map((item) => item.value)].sort((a, b) => b - a),
    );
    expect(values.at(-1)?.value).toBeGreaterThanOrEqual(0);
    expect(values.at(-1)?.value).toBeLessThanOrEqual(3);
    expect(values.at(-1)?.floorValue).toBeLessThanOrEqual(
      values.at(-1)!.medianValue,
    );
    expect(values.at(-1)?.ceilingValue).toBeLessThan(10);
    expect(udfaRb4.projectedPpg).toBe(16);
  });

  it("materially increases speculative value when an identical young RB moves from RB4 to RB2", () => {
    const profile = calculateReplacementProfiles(
      pool(),
      config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]),
    ).RB;
    const backup = {
      ...player("backup", "RB", 15),
      season: 2026,
      historicalGames: 0,
      draftStatus: "drafted" as const,
      draftRound: 4,
      depthRank: 4,
    };
    const promoted = { ...backup, playerId: "promoted", depthRank: 2 };
    expect(opportunityConfidence(promoted, profile)).toBeGreaterThan(
      opportunityConfidence(backup, profile),
    );
    expect(calculatePlayerValue(promoted, profile, 17).value).toBeGreaterThan(
      calculatePlayerValue(backup, profile, 17).value,
    );
  });

  it("keeps absent enrichment neutral and preserves more backup-QB opportunity in Superflex", () => {
    const unknown = player("unknown", "WR", 12);
    const oneQb = calculateReplacementProfiles(
      pool(),
      config(12, ["QB", "RB", "WR", "TE"]),
    ).QB;
    const superflex = { ...oneQb, demandPerTeam: 2 };
    const backupQb = {
      ...player("backup-qb", "QB", 14),
      depthRank: 2,
      draftStatus: "drafted" as const,
      draftRound: 1,
    };
    expect(draftCapitalConfidence(unknown)).toBe(1);
    expect(
      depthOpportunityFactor(
        unknown,
        calculateReplacementProfiles(
          pool(),
          config(10, ["QB", "RB", "WR", "TE"]),
        ).WR,
      ),
    ).toBe(1);
    expect(opportunityConfidence(backupQb, superflex)).toBeGreaterThan(
      opportunityConfidence(backupQb, oneQb),
    );
  });

  it("allocates FLEX demand only to RB/WR/TE", () => {
    const players = pool();
    const base = calculatePositionDemand(
      players,
      config(10, ["QB", "RB", "WR", "TE"]),
    );
    const flex = calculatePositionDemand(
      players,
      config(10, ["QB", "RB", "WR", "TE", "FLEX", "FLEX"]),
    );
    expect(flex.QB).toBe(base.QB);
    expect(flex.RB + flex.WR + flex.TE).toBe(base.RB + base.WR + base.TE + 20);
  });

  it("makes QB replacement and value materially different in Superflex", () => {
    const players = pool();
    const oneQb = calculatePlayerValues(
      players,
      config(12, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]),
      1,
    );
    const superflex = calculatePlayerValues(
      players,
      config(12, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"]),
      1,
    );
    const oneQbValue = oneQb.values.find((value) => value.playerId === "QB-5")!;
    const superflexValue = superflex.values.find(
      (value) => value.playerId === "QB-5",
    )!;
    expect(superflex.profiles.QB.demandedPlayers).toBeGreaterThan(
      oneQb.profiles.QB.demandedPlayers,
    );
    expect(superflexValue.value).toBeGreaterThan(oneQbValue.value);
  });

  it("lets league scoring change pass-catcher PPG without another projection", () => {
    const record = projectionRecord("rookie", "WR", {
      receptions: 8,
      receiving_yards: 80,
      receiving_touchdowns: 0.5,
    });
    const half = scoreProjectionPool([record], { rec: 0.5 })[0];
    const ppr = scoreProjectionPool([record], { rec: 1 })[0];
    expect(ppr.projectedPpg - half.projectedPpg).toBe(4);
  });

  it("makes reception-heavy players more valuable in PPR than Half PPR", () => {
    const records = (["QB", "RB", "WR", "TE"] as FantasyPosition[]).flatMap(
      (position) =>
        Array.from({ length: 35 }, (_, index) =>
          projectionRecord(
            `${position}-${index}`,
            position,
            position === "WR"
              ? {
                  receptions: index === 0 ? 10 : 3,
                  receiving_yards: 70 - index,
                  receiving_touchdowns: 0.3,
                }
              : position === "QB"
                ? { passing_yards: 220 - index, passing_touchdowns: 1.5 }
                : {
                    rush_attempts: 10,
                    rushing_yards: 45 - index * 0.5,
                    receptions: 2,
                    receiving_yards: 15,
                  },
          ),
        ),
    );
    const league = config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]);
    const half = calculatePlayerValues(
      scoreProjectionPool(records, { rec: 0.5 }),
      league,
      1,
    ).values.find((item) => item.playerId === "WR-0")!;
    const ppr = calculatePlayerValues(
      scoreProjectionPool(records, { rec: 1 }),
      { ...league, scoringSettings: { rec: 1 } },
      1,
    ).values.find((item) => item.playerId === "WR-0")!;
    expect(ppr.value).toBeGreaterThan(half.value);
  });

  it("values a rookie from a projection alone and handles an absent projection", () => {
    const players = [player("rookie", "WR", 32), ...pool()];
    const values = calculatePlayerValues(
      players,
      config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX"]),
      1,
    ).values;
    expect(
      values.find((value) => value.playerId === "rookie")?.value,
    ).toBeGreaterThan(0);
    expect(
      values.find((value) => value.playerId === "missing"),
    ).toBeUndefined();
  });

  it("calculates VORP, ROS VORP, deterministic ranks, and tiers", () => {
    const players = pool();
    const first = calculatePlayerValues(
      players,
      config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX"]),
      1,
    );
    const second = calculatePlayerValues(
      players,
      config(10, ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX"]),
      1,
    );
    const leader = first.values[0];
    expect(leader.rosVorp).toBeCloseTo(leader.vorpPerGame * 17, 1);
    expect(leader.overallRank).toBe(1);
    expect(leader.floorValue).toBeLessThanOrEqual(leader.medianValue);
    expect(leader.ceilingValue).toBeGreaterThanOrEqual(leader.medianValue);
    expect(
      first.values
        .filter((value) => value.position === "RB")
        .map((value) => value.positionRank)
        .slice(0, 3),
    ).toEqual([1, 2, 3]);
    expect(first.values).toEqual(second.values);
    expect(playerValueTier(42)).toBe("Elite Fantasy Asset");
    expect(playerValueTier(4)).toBe("Bench Value");
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
    const result = optimizeProjectedLineup(roster, [
      "QB",
      "RB",
      "WR",
      "TE",
      "FLEX",
      "SUPER_FLEX",
      "BN",
    ]);
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

function projectionRecord(
  playerId: string,
  position: string,
  stats: ValueProjectionRecord["projected_stats"],
): ValueProjectionRecord {
  return {
    player_id: playerId,
    season: 2026,
    week: 1,
    projected_stats: stats,
    residual_low: -5,
    residual_high: 7,
    confidence: "medium",
    players: {
      id: playerId,
      full_name: playerId,
      position,
      sleeper_position: position,
      historical_position: position,
      team: null,
      headshot_url: null,
      sleeper_player_id: null,
    },
  };
}
