import { describe, expect, it } from "vitest";
import { analyzeSleeperScoringCoverage, calculateLeagueSeasonPoints, withLeagueScoring } from "./league-scoring";
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

  it("scores points per carry and expected long-play events without awarding certain bonuses", () => {
    expect(calculateLeagueSeasonPoints({
      ...row,
      rush_attempts: 20,
      receptions_40_plus_yards: 0.12,
      receiving_touchdowns_40_plus_yards: 0.03,
    }, { rec: 1, rush_att: 0.1, rec_40p: 0.5, rec_td_40p: 0.7 })).toBe(152.08);
  });

  it("reports deterministic, expected-value, and unsupported offensive scoring", () => {
    const coverage = analyzeSleeperScoringCoverage({
      rec: 1,
      rush_att: 0.1,
      rec_40p: 0.5,
      fum_lost: -2,
      def_st_td: 6,
    });
    expect(coverage.settings).toEqual([
      { key: "rec", rate: 1, support: "deterministic" },
      { key: "rush_att", rate: 0.1, support: "deterministic" },
      { key: "rec_40p", rate: 0.5, support: "expected" },
      { key: "fum_lost", rate: -2, support: "unsupported" },
    ]);
    expect(coverage.coverage).toBe(0.75);
    expect(coverage.unsupported).toEqual(["fum_lost"]);
  });
});
