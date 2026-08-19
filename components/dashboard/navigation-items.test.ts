import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNavigationActive, NAVIGATION_ITEMS } from "./navigation-items";

const sidebarSource = readFileSync(new URL("./sidebar.tsx", import.meta.url), "utf8");
const appShellSource = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");

describe("application navigation", () => {
  it("uses one shared, complete link configuration", () => {
    expect(NAVIGATION_ITEMS.map((item) => [item.label, item.href])).toEqual([
      ["Dashboard", "/dashboard"],
      ["Players", "/players"],
      ["Matchups", "/matchups"],
      ["Start / Sit", "/start-sit"],
      ["Season Outlook", "/season"],
      ["Depth Charts", "/depth-charts"],
      ["Trade Finder", "/trades"],
      ["Connect League", "/dashboard/connect"],
    ]);
  });

  it("marks exact and nested routes active without confusing dashboard children", () => {
    const dashboard = NAVIGATION_ITEMS[0];
    const players = NAVIGATION_ITEMS[1];
    const connect = NAVIGATION_ITEMS[7];
    expect(isNavigationActive("/dashboard", dashboard)).toBe(true);
    expect(isNavigationActive("/dashboard/connect", dashboard)).toBe(false);
    expect(isNavigationActive("/dashboard/connect", connect)).toBe(true);
    expect(isNavigationActive("/players/player-id", players)).toBe(true);
    expect(isNavigationActive("/trades", players)).toBe(false);
  });

  it("uses an accessible mobile drawer instead of a horizontally scrolling link strip", () => {
    expect(sidebarSource).toContain('aria-controls="mobile-navigation-drawer"');
    expect(sidebarSource).toContain('role="dialog"');
    expect(sidebarSource).toContain('aria-modal="true"');
    expect(sidebarSource).toContain('event.key === "Escape"');
    expect(sidebarSource).toContain('event.key !== "Tab"');
    expect(sidebarSource).toContain("md:hidden");
    expect(sidebarSource).toContain("hidden min-h-screen");
    expect(sidebarSource).not.toContain("overflow-x-auto");
  });

  it("uses the same responsive shell and navigation for guest sessions", () => {
    expect(appShellSource).toContain("<Sidebar guest={guest} guestView={guestView}");
    expect(sidebarSource).toContain("guest ? NAVIGATION_ITEMS.filter");
    expect(sidebarSource).toContain('item.href !== "/dashboard/connect"');
    expect(sidebarSource).toContain("guestHref(item.href, guestLeagueId)");
    expect(sidebarSource).toContain('["/players", "/matchups", "/depth-charts"].includes(href)');
    expect(sidebarSource).toContain("<GuestAccountPanel");
  });
});
