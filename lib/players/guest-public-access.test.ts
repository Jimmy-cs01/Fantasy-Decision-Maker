import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260819023048_guest_public_football_read_access.sql", import.meta.url),
  "utf8",
);

describe("guest public football access migration", () => {
  it("keeps player search public instead of adding an application auth gate", () => {
    const route = readFileSync(new URL("../../app/api/players/search/route.ts", import.meta.url), "utf8");
    expect(route).not.toContain("Authentication required");
    expect(route).not.toContain("getUser()");
  });
  it.each([
    "players",
    "player_weekly_nfl_statistics",
    "model_versions",
    "player_projections",
    "player_depth_chart_roles",
    "nfl_games",
    "odds_games",
    "player_props",
    "player_season_stats",
    "available_player_seasons",
    "player_value_season_history",
    "odds_games_consensus",
    "player_props_consensus",
  ])("makes public football object %s anonymously readable", (object) => {
    expect(migration).toContain(`public.${object}`);
  });

  it("uses SELECT-only grants and keeps private account and league tables revoked", () => {
    expect(migration).not.toMatch(/grant\s+(insert|update|delete|all)[\s\S]*?to anon/i);
    for (const table of ["sleeper_accounts", "yahoo_accounts", "leagues", "fantasy_teams", "rosters", "roster_players", "synchronization_records"]) {
      expect(migration).toMatch(new RegExp(`revoke all[\\s\\S]*public\\.${table}[\\s\\S]*from anon`, "i"));
    }
  });

  it("keeps public analytics views security-invoker", () => {
    expect(migration.match(/security_invoker = true/g)).toHaveLength(5);
  });
});
