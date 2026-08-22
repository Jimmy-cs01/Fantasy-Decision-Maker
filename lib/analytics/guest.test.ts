import { describe, expect, it } from "vitest";
import { anonymousVisitorType, getOrCreateAnonymousId, normalizedAnonymousPath, shouldRecordAnalyticsEvent, validAnonymousId } from "./guest";

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

  it("distinguishes Guest Mode from ordinary anonymous browsing", () => {
    expect(anonymousVisitorType("/guest")).toBe("guest");
    expect(anonymousVisitorType("/guest/league/123")).toBe("guest");
    expect(anonymousVisitorType("/players")).toBe("anonymous");
  });

  it("removes player and league identifiers from stored analytics paths", () => {
    expect(normalizedAnonymousPath("/guest/league/123456789")).toBe("/guest/league/[leagueId]");
    expect(normalizedAnonymousPath("/dashboard/league/private-id/roster")).toBe("/dashboard/league/[leagueId]");
    expect(normalizedAnonymousPath("/players/player-uuid")).toBe("/players/[playerId]");
    expect(normalizedAnonymousPath("/matchups")).toBe("/matchups");
  });

  it("deduplicates immediate duplicate route events without suppressing later activity", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    expect(shouldRecordAnalyticsEvent(storage, "/players", 1_000)).toBe(true);
    expect(shouldRecordAnalyticsEvent(storage, "/players", 2_000)).toBe(false);
    expect(shouldRecordAnalyticsEvent(storage, "/players", 7_000)).toBe(true);
  });
});
