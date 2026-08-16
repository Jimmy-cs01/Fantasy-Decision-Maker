import { describe, expect, it } from "vitest";
import { latestCompletedSeason, rosterPlayerPpg, type RosterSeasonStatLine } from "./roster-stats";

const seasonRow = {
  player_id: "player-1",
  historical_position: "RB",
  games_played: 10,
  fantasy_points_standard: 100,
  fantasy_points_ppr_per_game: 15,
  passing_yards: 0,
  passing_touchdowns: 0,
  interceptions_thrown: 0,
  rushing_yards: 500,
  rushing_touchdowns: 5,
  receptions: 50,
  receiving_yards: 500,
  receiving_touchdowns: 5,
} satisfies RosterSeasonStatLine;

describe("roster previous-season PPG", () => {
  it("selects the latest completed season and excludes the current season", () => {
    expect(latestCompletedSeason([2023, 2025, 2024, 2026], 2026)).toBe(2025);
  });

  it("uses synced league scoring rather than silently using PPR", () => {
    expect(rosterPlayerPpg(seasonRow, { rec: 0 })).toBe(10);
    expect(rosterPlayerPpg(seasonRow, { rec: 0.5 })).toBe(12.5);
    expect(rosterPlayerPpg(seasonRow, { rec: 1 })).toBe(15);
  });

  it("falls back to PPR and preserves missing stats as null", () => {
    expect(rosterPlayerPpg(seasonRow, null)).toBe(15);
    expect(rosterPlayerPpg(null, { rec: 1 })).toBeNull();
  });
});

