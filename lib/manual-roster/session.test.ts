import { describe, expect, it } from "vitest";
import { MANUAL_ROSTER_KEY, parseManualRoster, readManualRoster, writeManualRoster } from "./session";

describe("manual roster session", () => {
  it("deduplicates and safely parses temporary roster IDs", () => {
    expect(parseManualRoster(JSON.stringify({ myPlayerIds: ["a", "a", 4], partnerPlayerIds: ["b"] }))).toEqual({ myPlayerIds: ["a"], partnerPlayerIds: ["b"] });
    expect(parseManualRoster("bad json")).toEqual({ myPlayerIds: [], partnerPlayerIds: [] });
  });

  it("uses session storage rather than permanent local storage", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    writeManualRoster({ myPlayerIds: ["a"], partnerPlayerIds: ["b"] }, storage);
    expect(values.has(MANUAL_ROSTER_KEY)).toBe(true);
    expect(readManualRoster(storage)).toEqual({ myPlayerIds: ["a"], partnerPlayerIds: ["b"] });
  });
});
