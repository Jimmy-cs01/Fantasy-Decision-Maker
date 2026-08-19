import { describe, expect, it } from "vitest";
import {
  GUEST_SESSION_KEY,
  clearGuestSession,
  guestLeagueHref,
  parseGuestSession,
  readGuestSession,
  writeGuestSession,
  type GuestSession,
} from "./session";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const session: GuestSession = {
  mode: "guest",
  sleeperUserId: "user-1",
  sleeperUsername: "jimmy",
  selectedLeagueId: "league-1",
  leagues: [{ leagueId: "league-1", name: "Test League", season: "2026", totalRosters: 12 }],
};

describe("guest session", () => {
  it("round trips only through the supplied session storage", () => {
    const storage = memoryStorage();
    writeGuestSession(session, storage);
    expect(readGuestSession(storage)).toEqual(session);
    expect(storage.getItem(GUEST_SESSION_KEY)).toContain("jimmy");
    clearGuestSession(storage);
    expect(readGuestSession(storage)).toBeNull();
  });

  it("rejects invalid or persistent-looking state", () => {
    expect(parseGuestSession("{}")).toBeNull();
    expect(parseGuestSession("not-json")).toBeNull();
  });

  it("builds scoped guest navigation URLs", () => {
    expect(guestLeagueHref("123")).toBe("/guest/league/123");
    expect(guestLeagueHref("123", "trades")).toBe("/guest/league/123?view=trades");
  });
});
