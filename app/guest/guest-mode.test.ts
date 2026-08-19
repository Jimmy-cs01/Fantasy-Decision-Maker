import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connect = readFileSync(new URL("../../components/guest/guest-connect.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../components/guest/guest-league-workspace.tsx", import.meta.url), "utf8");
const guestService = readFileSync(new URL("../../lib/guest/league.ts", import.meta.url), "utf8");
const login = readFileSync(new URL("../login/page.tsx", import.meta.url), "utf8");
const authenticatedSync = readFileSync(new URL("../../lib/db/sync-league.ts", import.meta.url), "utf8");

describe("guest mode architecture", () => {
  it("offers a clear guest path from login", () => {
    expect(login).toContain("Continue as Guest");
    expect(login).toContain('href="/guest"');
  });

  it("uses sessionStorage helpers and never localStorage", () => {
    expect(connect).toContain("writeGuestSession");
    expect(workspace).toContain("readGuestSession");
    expect(connect + workspace).not.toContain("localStorage");
  });

  it("exposes the read-only league tool set from one ephemeral payload", () => {
    expect(workspace).toContain("League Overview");
    expect(workspace).toContain("Trade Finder");
    expect(workspace).toContain("Start / Sit");
    expect(workspace).toContain("Season Outlook");
    expect(workspace).toContain('href="/matchups"');
    expect(workspace).toContain('href="/depth-charts"');
    expect(workspace).toContain("Sign Up / Save My League");
  });

  it("does not persist guest league ownership or roster rows", () => {
    expect(guestService).toContain("getEphemeralLeagueRosterAnalytics");
    expect(guestService).not.toMatch(/\.insert\(|\.upsert\(|\.delete\(/);
    expect(guestService).not.toContain("service_role");
  });

  it("preserves authenticated Supabase persistence as a separate path", () => {
    expect(authenticatedSync).toContain("sleeper_accounts");
    expect(authenticatedSync).toContain("roster_players");
    expect(authenticatedSync).toContain("owner_id: ownerId");
  });
});
