import { describe, expect, it, vi } from "vitest";
import {
  decodePlayerIdentifier,
  parsePlayerIdentifier,
  resolveCanonicalPlayerId,
} from "./identifiers";

function database(result: { data: { id: string } | null; error: unknown }) {
  const comparison = vi.fn(() => ({ maybeSingle: vi.fn(async () => result) }));
  const select = vi.fn(() => ({ eq: comparison }));
  const from = vi.fn(() => ({ select }));
  return { db: { from }, from, comparison };
}

describe("player identifier resolution", () => {
  it("recognizes canonical UUID player routes", () => {
    expect(parsePlayerIdentifier("6615f093-1004-4cd3-9b26-63b985d02d9e")).toEqual({
      kind: "uuid",
      value: "6615f093-1004-4cd3-9b26-63b985d02d9e",
    });
  });

  it("recognizes prefixed and URL-encoded Sleeper routes", () => {
    expect(parsePlayerIdentifier("sleeper:4046")).toEqual({ kind: "sleeper", value: "4046" });
    expect(decodePlayerIdentifier("sleeper%3A4046")).toBe("sleeper:4046");
    expect(parsePlayerIdentifier("sleeper%3A4046")).toEqual({ kind: "sleeper", value: "4046" });
  });

  it("queries UUID identifiers by id", async () => {
    const mock = database({ data: { id: "canonical-id" }, error: null });
    await expect(resolveCanonicalPlayerId(mock.db as never, "6615f093-1004-4cd3-9b26-63b985d02d9e")).resolves.toBe("canonical-id");
    expect(mock.comparison).toHaveBeenCalledWith("id", "6615f093-1004-4cd3-9b26-63b985d02d9e");
  });

  it("never compares Sleeper identifiers against the UUID id column", async () => {
    const mock = database({ data: { id: "canonical-id" }, error: null });
    await expect(resolveCanonicalPlayerId(mock.db as never, "sleeper%3A4046")).resolves.toBe("canonical-id");
    expect(mock.comparison).toHaveBeenCalledWith("sleeper_player_id", "4046");
    expect(mock.comparison).not.toHaveBeenCalledWith("id", expect.anything());
  });

  it("accepts a raw Sleeper ID and returns null for unknown or malformed players", async () => {
    const mock = database({ data: null, error: null });
    await expect(resolveCanonicalPlayerId(mock.db as never, "4046")).resolves.toBeNull();
    expect(mock.comparison).toHaveBeenCalledWith("sleeper_player_id", "4046");
    await expect(resolveCanonicalPlayerId(mock.db as never, "not:a:player")).resolves.toBeNull();
  });
});
