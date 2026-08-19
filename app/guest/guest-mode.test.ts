import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connect = readFileSync(new URL("../../components/guest/guest-connect.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../components/guest/guest-league-workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../../components/dashboard/sidebar.tsx", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../../components/dashboard/app-shell.tsx", import.meta.url), "utf8");
const leagueOverview = readFileSync(new URL("../../components/dashboard/league-overview.tsx", import.meta.url), "utf8");
const seasonOutlook = readFileSync(new URL("../../components/season/season-outlook-view.tsx", import.meta.url), "utf8");
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

  it("renders guest tools inside the authenticated app shell instead of a guest navigation strip", () => {
    expect(workspace).toContain("<AppShell guest guestView={view}>");
    expect(appShell).toContain("<Sidebar guest={guest} guestView={guestView}");
    expect(workspace).not.toContain('aria-label="Guest league features"');
    expect(workspace).not.toContain("GuestShell");
    expect(workspace).not.toContain("overflow-x-auto pb-1");
  });

  it("exposes the read-only league tool set through shared navigation and feature components", () => {
    expect(workspace).toContain("LeagueOverview");
    expect(workspace).toContain("Trade Finder");
    expect(workspace).toContain("Start / Sit");
    expect(workspace).toContain("SeasonOutlookView");
    expect(sidebar).toContain("NAVIGATION_ITEMS");
    expect(sidebar).toContain('href === "/trades"');
    expect(sidebar).toContain('href === "/start-sit"');
    expect(sidebar).toContain('href === "/season"');
  });

  it("shows ephemeral account and selected-league context in the shared sidebar", () => {
    expect(sidebar).toContain("Guest Session");
    expect(sidebar).toContain("Sign Up / Save League");
    expect(sidebar).toContain("selectedGuestLeague?.name");
    expect(sidebar).toContain("guestSession?.sleeperUsername");
    expect(sidebar).toContain("mobile-navigation-drawer");
  });

  it("shares the league dashboard and season presentation with authenticated pages", () => {
    expect(workspace).toContain("<LeagueOverview");
    expect(workspace).toContain("<SeasonOutlookView");
    expect(leagueOverview).toContain("<TeamSelector");
    expect(leagueOverview).toContain("<LeagueRoster");
    expect(seasonOutlook).toContain("Season Rankings &amp; Playoff Chances");
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
