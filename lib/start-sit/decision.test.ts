import { describe, expect, it } from "vitest";
import { isEligibleForLineupSlot, recommendStarts, resolveStartSitScoringSettings, startDecisionScore, type StartSitCandidate } from "./decision";

const player = (id: string, position: string, projectedPpg: number | null, overrides: Partial<StartSitCandidate> = {}): StartSitCandidate => ({
  id, name: id, position, projectedPpg, floor: projectedPpg == null ? null : projectedPpg - 5,
  ceiling: projectedPpg == null ? null : projectedPpg + 6, confidence: "medium", depthRole: `${position}1`, ...overrides,
});

describe("Start / Sit decisions", () => {
  it("normally starts the higher final projection in a two-player comparison", () => {
    const result = recommendStarts([player("A", "WR", 15), player("B", "WR", 13)]);
    expect(result.map((row) => row.id)).toEqual(["A", "B"]);
    expect(result[0].recommended).toBe(true);
  });

  it("ranks three-plus players and marks the configured number of starters", () => {
    const result = recommendStarts([player("C", "RB", 11), player("A", "RB", 16), player("B", "RB", 14)], { starters: 2 });
    expect(result.map((row) => row.id)).toEqual(["A", "B", "C"]);
    expect(result.filter((row) => row.recommended)).toHaveLength(2);
  });

  it("supports FLEX and SUPER_FLEX eligibility", () => {
    expect(isEligibleForLineupSlot("QB", "FLEX")).toBe(false);
    expect(isEligibleForLineupSlot("TE", "FLEX")).toBe(true);
    expect(isEligibleForLineupSlot("QB", "SUPER_FLEX")).toBe(true);
    expect(isEligibleForLineupSlot("WR", "SUPER_FLEX")).toBe(true);
  });

  it("keeps floor and confidence secondary and never adds Vegas separately", () => {
    const higher = player("higher", "WR", 15, { floor: 5, confidence: "low", teamImpliedTotal: 17 });
    const lower = player("lower", "WR", 14, { floor: 13, confidence: "high", teamImpliedTotal: 31 });
    expect(startDecisionScore(higher)).toBeGreaterThan(startDecisionScore(lower));
    expect(startDecisionScore({ ...higher, teamImpliedTotal: 40 })).toBe(startDecisionScore(higher));
  });

  it("handles missing projections without crashing or recommending them", () => {
    const result = recommendStarts([player("missing", "WR", null), player("available", "WR", 8)]);
    expect(result[0].id).toBe("available");
    expect(result.at(-1)?.startScore).toBe(Number.NEGATIVE_INFINITY);
  });

  it("uses selected-league scoring before manual Standard/Half/PPR fallbacks", () => {
    expect(resolveStartSitScoringSettings({ rec: 1.5, rec_fd: 0.5 }, "standard")).toEqual({ rec: 1.5, rec_fd: 0.5 });
    expect(resolveStartSitScoringSettings(null, "half_ppr")).toEqual({ rec: 0.5 });
  });
});
