import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("league synchronization persistence contract", () => {
  it("uses unique conflict keys so repeat imports update instead of duplicate", () => {
    const source = readFileSync(new URL("./sync-league.ts", import.meta.url), "utf8");
    expect(source).toContain('onConflict: "owner_id,sleeper_league_id"');
    expect(source).toContain('onConflict: "league_id,sleeper_roster_id"');
    expect(source).toContain('from("roster_players").delete()');
  });
});
