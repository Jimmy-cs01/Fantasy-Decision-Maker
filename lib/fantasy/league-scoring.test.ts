import { describe, expect, it } from "vitest";
import { calculateLeagueSeasonPoints, withLeagueScoring } from "./league-scoring";
import type { PlayerSeasonRow } from "@/lib/players/types";

const row = {
  historical_position: "TE", games_played: 10, fantasy_points_standard: 100,
  passing_yards: 0, passing_touchdowns: 0, interceptions_thrown: 0,
  rushing_yards: 0, rushing_touchdowns: 0, receptions: 50,
  receiving_yards: 500, receiving_touchdowns: 5,
  completions: 0, pass_attempts: 0, passing_first_downs: 0,
  rush_attempts: 0, rushing_first_downs: 0, receiving_first_downs: 20,
} as PlayerSeasonRow;

describe("Sleeper league scoring", () => {
  it("uses the league's exact custom reception rate", () => {
    expect(calculateLeagueSeasonPoints(row, { rec: 0.75 })).toBe(137.5);
  });

  it("adds supported position-specific reception and first-down scoring", () => {
    expect(calculateLeagueSeasonPoints(row, { rec: 1, bonus_rec_te: 0.5, rec_fd: 0.25 })).toBe(180);
  });

  it("calculates league PPG from league points and actual games", () => {
    expect(withLeagueScoring(row, { rec: 1 })).toMatchObject({ fantasy_points_league: 150, fantasy_points_league_per_game: 15 });
  });
});

