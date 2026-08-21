import { describe, expect, it } from "vitest";
import { getOrCreateAnonymousId, validAnonymousId } from "./guest";

describe("guest analytics identity", () => {
  it("reuses a valid browser ID across refreshes", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(getOrCreateAnonymousId(storage, "browser", () => id)).toBe(id);
    expect(getOrCreateAnonymousId(storage, "browser", () => "never-used")).toBe(id);
  });

  it("rejects malformed identifiers", () => {
    expect(validAnonymousId("guest-one")).toBe(false);
    expect(validAnonymousId("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
  });
});
