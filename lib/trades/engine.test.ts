import { describe, expect, it } from "vitest";
import {
  diversifyTradeSuggestions,
  evaluateTrade,
  findTradeSuggestions,
  tradePackages,
  tradeTotals,
  type TradePlayer,
} from "./engine";

const player = (
  id: string,
  teamId: string,
  position: string,
  value: number,
  projectedPpg = value / 2,
): TradePlayer => ({
  id,
  teamId,
  name: id,
  position,
  nflTeam: null,
  headshotUrl: null,
  value,
  projectedPpg,
});

describe("Trade Finder", () => {
  const mine = [
    player("my-qb", "mine", "QB", 20),
    player("my-rb", "mine", "RB", 18),
    player("my-wr", "mine", "WR", 12),
    player("my-wr2", "mine", "WR", 8),
  ];
  const theirs = [
    player("their-qb", "other", "QB", 21),
    player("their-rb", "other", "RB", 17),
    player("their-wr", "other", "WR", 11),
    player("their-te", "other", "TE", 7),
  ];
  const slots = ["QB", "RB", "WR", "TE", "FLEX", "BN"];

  it("totals manual multi-player packages deterministically", () => {
    expect(tradeTotals([mine[1], mine[2]], [theirs[0]])).toMatchObject({
      sendValue: 30,
      receiveValue: 21,
      difference: -9,
    });
  });

  it("finds close-value candidates from synchronized roster inputs", () => {
    const results = findTradeSuggestions({
      myRoster: mine,
      otherRosters: [theirs],
      rosterPositions: slots,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (result) =>
          result.send.every((item) => item.teamId === "mine") &&
          result.receive.every((item) => item.teamId === "other"),
      ),
    ).toBe(true);
    expect(results.every((result) => result.percentageDifference <= 0.2)).toBe(
      true,
    );
  });

  it("requires the selected player in specific-player mode", () => {
    const results = findTradeSuggestions({
      myRoster: mine,
      otherRosters: [theirs],
      rosterPositions: slots,
      specificPlayerId: "my-rb",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every((result) =>
        result.send.some((item) => item.id === "my-rb"),
      ),
    ).toBe(true);
  });

  it("builds only packages containing the requested player instead of filtering a whole-roster search", () => {
    const packages = tradePackages(mine, 2, "my-rb");
    expect(packages).toHaveLength(mine.length);
    expect(
      packages.every((items) => items.some((item) => item.id === "my-rb")),
    ).toBe(true);
  });

  it("deduplicates packages and limits supported package shapes", () => {
    const results = findTradeSuggestions({
      myRoster: mine,
      otherRosters: [theirs],
      rosterPositions: slots,
    });
    const keys = results.map(
      (result) =>
        result.send
          .map((item) => item.id)
          .sort()
          .join("+") +
        "->" +
        result.receive
          .map((item) => item.id)
          .sort()
          .join("+"),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      results.every(
        (result) =>
          (result.send.length <= 2 && result.receive.length <= 2) ||
          (result.send.length === 2 && result.receive.length === 3) ||
          (result.send.length === 3 && result.receive.length === 2),
      ),
    ).toBe(true);
  });

  it("does not crash when projections or values are missing", () => {
    const missing = {
      ...player("missing", "other", "RB", 0),
      value: null,
      projectedPpg: null,
    };
    expect(() =>
      findTradeSuggestions({
        myRoster: mine,
        otherRosters: [[...theirs, missing]],
        rosterPositions: slots,
      }),
    ).not.toThrow();
  });

  it("does not require depth-chart fields to generate automatic suggestions", () => {
    const results = findTradeSuggestions({
      myRoster: mine,
      otherRosters: [theirs],
      rosterPositions: slots,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(mine.every((item) => !("depthRank" in item))).toBe(true);
  });

  it("simulates both lineups and recognizes when only one incoming player starts", () => {
    const myRoster = [
      player("my-rb", "mine", "RB", 15, 10),
      player("my-wr", "mine", "WR", 15, 10),
      player("my-bench", "mine", "WR", 5, 4),
    ];
    const opponentRoster = [
      player("opp-rb", "other", "RB", 20, 15),
      player("opp-wr", "other", "WR", 20, 15),
      player("opp-wr2", "other", "WR", 5, 5),
    ];
    const result = evaluateTrade({
      myRoster,
      opponentRoster,
      send: [myRoster[0], myRoster[1]],
      receive: [opponentRoster[1]],
      rosterPositions: ["RB", "WR"],
    });
    expect(result.opponentImpact.promotedStarterIds.filter((id) => ["my-rb", "my-wr"].includes(id))).toHaveLength(1);
    expect(result.reasons.some((reason) => reason.includes("Only 1 of 2"))).toBe(true);
  });

  it("recognizes when both incoming players improve legal starter slots", () => {
    const myRoster = [
      player("my-rb", "mine", "RB", 8, 6),
      player("my-wr", "mine", "WR", 8, 6),
      player("my-elite", "mine", "QB", 30, 22),
    ];
    const opponentRoster = [
      player("opp-rb", "other", "RB", 20, 15),
      player("opp-wr", "other", "WR", 20, 14),
      player("opp-qb", "other", "QB", 10, 10),
    ];
    const result = evaluateTrade({
      myRoster,
      opponentRoster,
      send: [myRoster[2]],
      receive: [opponentRoster[0], opponentRoster[1]],
      rosterPositions: ["QB", "RB", "WR"],
    });
    expect(result.myImpact.promotedStarterIds).toEqual(
      expect.arrayContaining(["opp-rb", "opp-wr"]),
    );
  });

  it("recognizes when neither incoming player can improve a lineup", () => {
    const myRoster = [
      player("my-qb", "mine", "QB", 25, 20),
      player("my-rb", "mine", "RB", 25, 18),
      player("my-wr", "mine", "WR", 25, 18),
    ];
    const opponentRoster = [
      player("opp-rb", "other", "RB", 8, 5),
      player("opp-wr", "other", "WR", 8, 5),
      player("opp-qb", "other", "QB", 30, 21),
    ];
    const result = evaluateTrade({
      myRoster,
      opponentRoster,
      send: [myRoster[0]],
      receive: [opponentRoster[0], opponentRoster[1]],
      rosterPositions: ["QB", "RB", "WR"],
    });
    expect(result.myImpact.promotedStarterIds).not.toEqual(
      expect.arrayContaining(["opp-rb", "opp-wr"]),
    );
    expect(result.myImpact.starterPpgDelta).toBeLessThan(0);
  });

  it("keeps consolidation continuous and bounded", () => {
    const result = evaluateTrade({
      myRoster: mine,
      opponentRoster: theirs,
      send: [mine[1], mine[2]],
      receive: [theirs[0]],
      rosterPositions: slots,
      leagueTeams: 12,
    });
    expect(result.myImpact.consolidationAdjustment).toBeGreaterThanOrEqual(0);
    expect(result.myImpact.consolidationAdjustment).toBeLessThanOrEqual(2.5);
  });

  it("supports 2-for-3 and 3-for-2 without allowing 3-for-3", () => {
    const results = findTradeSuggestions({
      myRoster: [...mine, player("my-te", "mine", "TE", 7)],
      otherRosters: [[...theirs, player("their-wr2", "other", "WR", 5)]],
      rosterPositions: slots,
      valueWindow: 0.5,
    });
    expect(results.every((result) => !(result.send.length === 3 && result.receive.length === 3))).toBe(true);
    expect(tradePackages(mine, 3).some((items) => items.length === 3)).toBe(true);
  });

  it("diversifies the first result round across opponents", () => {
    const rosters = Array.from({ length: 9 }, (_, index) =>
      theirs.map((item, playerIndex) => ({ ...item, id: `t${index}-${playerIndex}`, teamId: `team-${index}` })),
    );
    const results = findTradeSuggestions({ myRoster: mine, otherRosters: rosters, rosterPositions: slots });
    expect(new Set(results.slice(0, 9).map((result) => result.opponentTeamId)).size).toBe(9);
    expect(results.filter((result) => result.opponentTeamId === "team-0").length).toBeLessThanOrEqual(2);
  });

  it("does not let a third low-value bench filler dominate roster impact", () => {
    const base = evaluateTrade({
      myRoster: mine,
      opponentRoster: [...theirs, player("filler", "other", "QB", 1, 1)],
      send: [mine[1], mine[2]],
      receive: [theirs[0], theirs[3]],
      rosterPositions: slots,
    });
    const withFiller = evaluateTrade({
      myRoster: mine,
      opponentRoster: [...theirs, player("filler", "other", "QB", 1, 1)],
      send: [mine[1], mine[2]],
      receive: [theirs[0], theirs[3], player("filler", "other", "QB", 1, 1)],
      rosterPositions: slots,
    });
    expect(Math.abs(withFiller.myImpact.effectiveDelta - base.myImpact.effectiveDelta)).toBeLessThan(2);
  });

  it("penalizes a trade that leaves a required lineup slot empty", () => {
    const myRoster = [
      player("only-qb", "mine", "QB", 20, 18),
      player("my-rb", "mine", "RB", 20, 15),
    ];
    const opponentRoster = [
      player("opp-wr", "other", "WR", 20, 15),
      player("opp-rb", "other", "RB", 20, 15),
    ];
    const result = evaluateTrade({
      myRoster,
      opponentRoster,
      send: [myRoster[0]],
      receive: [opponentRoster[0]],
      rosterPositions: ["QB", "RB"],
    });
    expect(result.myImpact.completeBefore).toBe(true);
    expect(result.myImpact.completeAfter).toBe(false);
    expect(result.reasons).toContain("Trade creates an unfilled starting-lineup slot");
  });

  it("honors Superflex eligibility during trade simulation", () => {
    const myRoster = [
      player("qb-one", "mine", "QB", 25, 20),
      player("weak-flex", "mine", "WR", 7, 6),
      player("my-rb", "mine", "RB", 15, 12),
    ];
    const opponentRoster = [
      player("qb-two", "other", "QB", 20, 16),
      player("opp-rb", "other", "RB", 15, 12),
    ];
    const result = evaluateTrade({
      myRoster,
      opponentRoster,
      send: [myRoster[2]],
      receive: [opponentRoster[0]],
      rosterPositions: ["QB", "SUPER_FLEX"],
    });
    expect(result.myImpact.promotedStarterIds).toContain("qb-two");
    expect(result.myImpact.starterPpgDelta).toBeGreaterThan(0);
  });
});
