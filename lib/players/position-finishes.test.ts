import { describe, expect, it } from "vitest";
import type { PlayerSeasonRow } from "./types";
import { calculateHistoricalPositionFinishes } from "./position-finishes";

const row = (player_id: string, historical_position: string, receptions: number, standard: number): PlayerSeasonRow => ({
  player_id, historical_position, season: 2025, season_type: "REG", games_played: 17,
  fantasy_points_standard: standard, receptions, receiving_yards: 0, receiving_touchdowns: 0,
} as PlayerSeasonRow);

describe("historical final position finishes", () => {
  it("ranks total points within the complete position cohort", () => {
    const finishes = calculateHistoricalPositionFinishes([row("A", "TE", 10, 100), row("B", "TE", 5, 120)], "A", { rec: 0 });
    expect(finishes.get(2025)).toBe(2);
  });

  it("changes with selected league scoring", () => {
    const rows = [row("A", "TE", 40, 100), row("B", "TE", 5, 120)];
    expect(calculateHistoricalPositionFinishes(rows, "A", { rec: 0 }).get(2025)).toBe(2);
    expect(calculateHistoricalPositionFinishes(rows, "A", { rec: 1 }).get(2025)).toBe(1);
  });

  it("does not mix positions supplied by the caller", () => {
    const rows = [row("A", "TE", 10, 100), row("QB", "QB", 0, 400)].filter((item) => item.historical_position === "TE");
    expect(calculateHistoricalPositionFinishes(rows, "A", { rec: 1 }).get(2025)).toBe(1);
  });
});
