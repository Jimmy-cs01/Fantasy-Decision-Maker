import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Yahoo league synchronization contract", () => {
  const source = readFileSync(new URL("./sync-yahoo-league.ts", import.meta.url), "utf8");
  it("is provider-idempotent and records Yahoo synchronization", () => {
    expect(source).toContain('onConflict: "owner_id,provider,external_league_id"');
    expect(source).toContain('source: "yahoo"');
    expect(source).toContain('onConflict: "league_id,provider_team_id"');
  });
  it("does not manufacture canonical identities for ambiguous players", () => {
    expect(source).toContain("candidates.length === 1");
    expect(source).toContain("unmapped += 1");
    expect(source).not.toContain('from("players").insert');
  });
});
