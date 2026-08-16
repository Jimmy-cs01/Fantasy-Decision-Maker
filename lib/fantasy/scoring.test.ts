import { describe, expect, it } from "vitest";
import { calculateFantasyPoints } from "./scoring";

describe("calculateFantasyPoints", () => {
  it("uses supplied league settings instead of a hard-coded scoring format", () => {
    expect(calculateFantasyPoints({ pass_yd: 300, pass_td: 2, int: 1 }, { pass_yd: 0.04, pass_td: 4, int: -2 })).toBe(18);
  });
});
