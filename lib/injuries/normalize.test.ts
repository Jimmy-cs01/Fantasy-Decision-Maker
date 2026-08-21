import { describe, expect, it } from "vitest";
import { normalizeInjuryStatus, normalizeSleeperInjury } from "./normalize";

describe("Sleeper injury normalization", () => {
  it("normalizes actionable statuses without treating NA/DNR as injured", () => {
    expect(normalizeInjuryStatus("Questionable", "Active")).toBe("questionable");
    expect(normalizeInjuryStatus("IR", "Injured Reserve")).toBe("ir");
    expect(normalizeInjuryStatus("NA", "Active")).toBe("healthy");
    expect(normalizeInjuryStatus("DNR", "Active")).toBe("healthy");
  });

  it("marks reserve-list duration as estimated rather than reported", () => {
    const result = normalizeSleeperInjury("p1", { player_id: "s1", injury_status: "IR", status: "Injured Reserve" }, "2026-09-01T00:00:00Z");
    expect(result.timeline_type).toBe("estimated");
    expect(result.timeline_confidence).toBe("low");
    expect(result.expected_games_missed).toBe(4);
  });
});
