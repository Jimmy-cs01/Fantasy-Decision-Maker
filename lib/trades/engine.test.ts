import { describe, expect, it } from "vitest";
import {
  calculateMarginalDepthUtility,
  diversifyTradeSuggestions,
  evaluateTrade,
  findTradeSuggestions,
  supportedAutomaticTradeShape,
  tradePackages,
  tradeTotals,
  type TradePlayer,
  type TradeSuggestion,
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

  it("supports bounded 3-for-3 packages alongside existing package shapes", () => {
    const results = findTradeSuggestions({
      myRoster: [...mine, player("my-te", "mine", "TE", 7)],
      otherRosters: [[...theirs, player("their-wr2", "other", "WR", 5)]],
      rosterPositions: slots,
      valueWindow: 0.5,
    });
    expect(results.every((result) => result.send.length <= 3 && result.receive.length <= 3)).toBe(true);
    expect(tradePackages(mine, 3).some((items) => items.length === 3)).toBe(true);
    expect(supportedAutomaticTradeShape(3, 3)).toBe(true);
    expect(supportedAutomaticTradeShape(1, 3)).toBe(false);
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

  it("gives useful first-line depth much more utility than an RB6-level addition", () => {
    const starter = player("starter", "mine", "RB", 30, 17);
    const usefulBefore = [starter, player("weak-rb3", "mine", "RB", 7, 5)];
    const usefulAfter = [...usefulBefore, player("useful-rb3", "mine", "RB", 18, 10)];
    const deepBefore = [
      starter,
      player("rb3", "mine", "RB", 20, 11),
      player("rb4", "mine", "RB", 15, 9),
      player("rb5", "mine", "RB", 10, 7),
    ];
    const deepAfter = [...deepBefore, player("rb6", "mine", "RB", 10, 7.5)];
    const usefulGain = calculateMarginalDepthUtility(usefulAfter, [starter.id])
      - calculateMarginalDepthUtility(usefulBefore, [starter.id]);
    const buriedGain = calculateMarginalDepthUtility(deepAfter, [starter.id])
      - calculateMarginalDepthUtility(deepBefore, [starter.id]);
    expect(usefulGain).toBeGreaterThan(0.4);
    expect(buriedGain).toBeLessThan(0.1);
    expect(usefulGain).toBeGreaterThan(buriedGain * 8);
  });

  it("drops the weakest player when an asymmetric package exceeds roster capacity", () => {
    const myRoster = [
      player("starter", "mine", "RB", 25, 15),
      player("bench", "mine", "RB", 12, 9),
      player("outgoing", "mine", "WR", 8, 7),
    ];
    const opponentRoster = [
      player("incoming", "other", "WR", 12, 10),
      player("filler", "other", "RB", 2, 3),
      player("opp-starter", "other", "QB", 25, 18),
    ];
    const result = evaluateTrade({
      myRoster,
      opponentRoster,
      send: [myRoster[2]],
      receive: [opponentRoster[0], opponentRoster[1]],
      rosterPositions: ["RB", "BN", "BN"],
    });
    expect(result.myImpact.droppedPlayerIds).toEqual(["filler"]);
    expect(result.myImpact.assetValueDelta).toBe(4);
    expect(result.myImpact.rosterCapacityAdjustment).toBeLessThanOrEqual(0);
  });

  it("charges the effective asset change for an existing player displaced by roster limits", () => {
    const myRoster = [
      player("starter", "mine", "RB", 25, 15),
      player("weak-existing", "mine", "WR", 5, 4),
      player("outgoing", "mine", "TE", 10, 7),
    ];
    const opponentRoster = [
      player("incoming-one", "other", "WR", 14, 10),
      player("incoming-two", "other", "TE", 12, 9),
      player("opp-starter", "other", "QB", 25, 18),
    ];
    const result = evaluateTrade({
      myRoster,
      opponentRoster,
      send: [myRoster[2]],
      receive: [opponentRoster[0], opponentRoster[1]],
      rosterPositions: ["RB", "FLEX", "BN"],
    });
    expect(result.myImpact.droppedPlayerIds).toContain("weak-existing");
    expect(result.myImpact.assetValueDelta).toBe(11);
    expect(result.myImpact.rosterCapacityAdjustment).toBeLessThan(0);
  });

  it("values a freed roster slot modestly rather than as another full asset", () => {
    const result = evaluateTrade({
      myRoster: mine,
      opponentRoster: theirs,
      send: [mine[2], mine[3]],
      receive: [theirs[2]],
      rosterPositions: slots,
    });
    expect(result.myImpact.freedRosterSlots).toBeGreaterThan(0);
    expect(result.myImpact.rosterCapacityAdjustment).toBeGreaterThan(0);
    expect(result.myImpact.rosterCapacityAdjustment).toBeLessThanOrEqual(0.45);
  });

  it("keeps lineup loss dominant over consolidation credit", () => {
    const myRoster = [
      player("elite-qb", "mine", "QB", 40, 25),
      player("strong-rb", "mine", "RB", 25, 17),
      player("bench", "mine", "WR", 8, 6),
    ];
    const opponentRoster = [
      player("weak-qb", "other", "QB", 15, 10),
      player("other", "other", "RB", 10, 8),
    ];
    const result = evaluateTrade({
      myRoster,
      opponentRoster,
      send: [myRoster[0], myRoster[2]],
      receive: [opponentRoster[0]],
      rosterPositions: ["QB", "RB", "BN"],
    });
    expect(result.myImpact.effectiveDelta).toBeLessThan(0);
    expect(result.myImpact.starterPpgComponent).toBeLessThan(-20);
  });

  it("applies package complexity only as a modest evaluation adjustment", () => {
    const oneForOne = evaluateTrade({
      myRoster: mine,
      opponentRoster: theirs,
      send: [mine[1]],
      receive: [theirs[1]],
      rosterPositions: slots,
    });
    const twoForThree = evaluateTrade({
      myRoster: [...mine, player("my-filler", "mine", "TE", 1, 1)],
      opponentRoster: [...theirs, player("opp-filler", "other", "WR", 1, 1), player("opp-filler2", "other", "RB", 1, 1)],
      send: [mine[1], mine[2]],
      receive: [theirs[1], player("opp-filler", "other", "WR", 1, 1), player("opp-filler2", "other", "RB", 1, 1)],
      rosterPositions: slots,
    });
    expect(oneForOne.packageComplexityAdjustment).toBe(0);
    expect(twoForThree.packageComplexityAdjustment).toBeLessThan(0);
    expect(twoForThree.packageComplexityAdjustment).toBeGreaterThan(-2);
    expect(twoForThree.scoreComponents).toMatchObject({
      my: {
        starterPpgDelta: twoForThree.myImpact.starterPpgDelta,
        marginalDepthDelta: twoForThree.myImpact.marginalDepthDelta,
        rosterCapacityAdjustment: twoForThree.myImpact.rosterCapacityAdjustment,
      },
      packageComplexityAdjustment: twoForThree.packageComplexityAdjustment,
      finalTradeFit: twoForThree.finalTradeFit,
    });
  });

  it("prefers simpler shapes when quality is similar but preserves a clearly superior package", () => {
    const makeSuggestion = (sendSize: number, receiveSize: number, score: number): TradeSuggestion => {
      const send = Array.from({ length: sendSize }, (_, index) => player(`send-${sendSize}-${index}`, "mine", "RB", 10, 8));
      const receive = Array.from({ length: receiveSize }, (_, index) => player(`receive-${receiveSize}-${index}`, "other", "WR", 10, 8));
      const evaluated = evaluateTrade({
        myRoster: [...send, player("my-qb-fixture", "mine", "QB", 20, 18)],
        opponentRoster: [...receive, player("opp-qb-fixture", "other", "QB", 20, 18)],
        send,
        receive,
        rosterPositions: ["QB", "FLEX", "FLEX", "BN", "BN", "BN"],
      });
      return { ...evaluated, opponentTeamId: "other", score };
    };
    const similar = diversifyTradeSuggestions([
      makeSuggestion(2, 3, 100),
      makeSuggestion(1, 1, 99),
      makeSuggestion(2, 2, 98.5),
    ]);
    expect(similar[0].tradeShape).toBe("1-for-1");
    expect(similar[1].tradeShape).toBe("2-for-2");

    const clearlySuperior = diversifyTradeSuggestions([
      makeSuggestion(2, 3, 106),
      makeSuggestion(1, 1, 99),
      makeSuggestion(2, 2, 98),
    ]);
    expect(clearlySuperior[0].tradeShape).toBe("2-for-3");
  });

  it("allows a strong 3-for-3 recommendation into the diverse result set", () => {
    const send = [mine[0], mine[1], mine[2]];
    const receive = [theirs[0], theirs[1], theirs[2]];
    const evaluated = evaluateTrade({ myRoster: mine, opponentRoster: theirs, send, receive, rosterPositions: slots });
    const suggestion: TradeSuggestion = { ...evaluated, opponentTeamId: "other", score: 110 };
    expect(diversifyTradeSuggestions([suggestion])[0].tradeShape).toBe("3-for-3");
  });
});
