import { describe, expect, it } from "vitest";
import { analyzeDstScoring } from "./dst-scoring";

describe("Sleeper DST scoring coverage", () => {
  it("recognizes common Sleeper DST categories without fabricating a projection", () => {
    const result = analyzeDstScoring({ sack: 1, int: 2, fum_rec: 2, def_td: 6, pts_allow_0: 10 });
    expect(result.scoringCoverage).toBe(1);
    expect(result.projectionEnabled).toBe(false);
    expect(result.reason).toContain("remain disabled");
  });

  it("surfaces unsupported defensive categories explicitly", () => {
    const result = analyzeDstScoring({ sack: 1, def_obscure_bonus: 4, qb_hit: 0.25 });
    expect(result.supported).toContain("sack");
    expect(result.unsupported).toEqual(["def_obscure_bonus", "qb_hit"]);
  });
});
