import { describe, expect, it } from "vitest";
import { calculateImpliedTeamTotals } from "./implied-totals";

describe("calculateImpliedTeamTotals", () => {
  it("uses a home-perspective spread", () => {
    expect(calculateImpliedTeamTotals(48, -6)).toEqual({ home: 27, away: 21 });
  });

  it("rejects malformed markets", () => {
    expect(() => calculateImpliedTeamTotals(-1, 3)).toThrow(/non-negative/);
  });
});
