import { describe, expect, it } from "vitest";
import { normalizeLeague, normalizeRoster, normalizeSleeperPlayer } from "./service";

describe("Sleeper normalization", () => {
  it("keeps external IDs separate from local database IDs", () => {
    expect(normalizeSleeperPlayer({ player_id: "4046", first_name: "Josh", last_name: "Allen", position: "QB" })).toMatchObject({ sleeper_player_id: "4046", full_name: "Josh Allen", position: "QB" });
  });
  it("normalizes optional Sleeper league and roster fields safely", () => {
    expect(normalizeLeague({ league_id: "league-1", name: "Friends", season: "2026", sport: "nfl" })).toMatchObject({ season: 2026, scoring_settings: {} });
    expect(normalizeRoster({ roster_id: 1 })).toMatchObject({ starters: [], reserve: [], players: [] });
  });
});
