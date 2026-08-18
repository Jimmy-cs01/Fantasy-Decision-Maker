import { describe, expect, it } from "vitest";
import {
  isTradeEvaluationSupportedSlot,
  normalizeTradeEvaluationSlot,
  tradeEvaluationRosterPositions,
} from "./lineup-slots";

describe("Trade Finder lineup slots", () => {
  it.each(["K", "PK", "KICKER"])("normalizes %s as kicker", (slot) => {
    expect(normalizeTradeEvaluationSlot(slot)).toBe("K");
    expect(isTradeEvaluationSupportedSlot(slot)).toBe(false);
  });

  it.each(["DEF", "DST", "D/ST", "D_ST", "DEF/ST", "TEAM_DEFENSE"])(
    "normalizes %s as team defense",
    (slot) => {
      expect(normalizeTradeEvaluationSlot(slot)).toBe("DEF");
      expect(isTradeEvaluationSupportedSlot(slot)).toBe(false);
    },
  );

  it("retains supported skill-position and flexible lineup slots", () => {
    expect(
      tradeEvaluationRosterPositions([
        "QB",
        "RB",
        "WR",
        "TE",
        "FLEX",
        "SUPER_FLEX",
        "K",
        "D/ST",
      ]),
    ).toEqual(["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX"]);
  });
});
