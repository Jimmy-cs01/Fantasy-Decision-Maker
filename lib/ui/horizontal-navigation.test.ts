import { describe, expect, it } from "vitest";
import {
  adjacentNavigationIndex,
  horizontalScrollState,
  horizontalWheelDelta,
} from "./horizontal-navigation";

describe("horizontal navigation", () => {
  it("enables arrows only when content remains in that direction", () => {
    expect(horizontalScrollState(0, 400, 900)).toEqual({
      canScrollLeft: false,
      canScrollRight: true,
    });
    expect(horizontalScrollState(250, 400, 900)).toEqual({
      canScrollLeft: true,
      canScrollRight: true,
    });
    expect(horizontalScrollState(500, 400, 900)).toEqual({
      canScrollLeft: true,
      canScrollRight: false,
    });
  });

  it("translates a normal mouse wheel while preserving native horizontal deltas", () => {
    expect(horizontalWheelDelta(0, 120)).toBe(120);
    expect(horizontalWheelDelta(-140, 10)).toBe(-140);
    expect(horizontalWheelDelta(0, 3, 1, 300)).toBe(120);
    expect(horizontalWheelDelta(0, 1, 2, 300)).toBe(300);
  });

  it("moves keyboard focus without wrapping or trapping it", () => {
    expect(adjacentNavigationIndex(2, "right", 5)).toBe(3);
    expect(adjacentNavigationIndex(4, "right", 5)).toBe(4);
    expect(adjacentNavigationIndex(0, "left", 5)).toBe(0);
  });
});
