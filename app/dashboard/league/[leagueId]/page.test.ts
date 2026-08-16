import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("league roster query contract", () => {
  it("loads headshots from players and batches season stats for the roster", () => {
    expect(source).toContain("players(id,sleeper_player_id,full_name,position,team,headshot_url)");
    expect(source).toContain('.in("player_id", rosterPlayers.map');
  });

  it("uses only the latest completed regular season for roster PPG", () => {
    expect(source).toContain('from("available_player_seasons")');
    expect(source).toContain('.lt("season", currentYear)');
    expect(source).toContain('.eq("season_type", "REG")');
  });
});
