import { describe, expect, it } from "vitest";
import {
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

  it("deduplicates packages and limits package size", () => {
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
        (result) => result.send.length <= 2 && result.receive.length <= 2,
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
});
