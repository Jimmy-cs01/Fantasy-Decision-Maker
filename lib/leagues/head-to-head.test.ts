import { describe, expect, it } from "vitest";
import { optimizeProjectedLineup } from "@/lib/player-values/lineup";
import { buildHeadToHeadSchedule } from "./head-to-head";

describe("Sleeper head-to-head schedule", () => {
  it("uses actual completed scores and optimized future lineups", () => {
    const lineup = optimizeProjectedLineup([
      { playerId: "qb", position: "QB", projectedPpg: 20 },
      { playerId: "rb", position: "RB", projectedPpg: 15 },
    ], ["QB", "RB"]);
    const rows = buildHeadToHeadSchedule({
      teams: [
        { id: "a", sleeperRosterId: 1, name: "A", isMyTeam: true },
        { id: "b", sleeperRosterId: 2, name: "B", isMyTeam: false },
      ],
      matchupRowsByWeek: new Map([[1, [
        { roster_id: 1, matchup_id: 7, points: 121 },
        { roster_id: 2, matchup_id: 7, points: 110 },
      ]], [2, [
        { roster_id: 1, matchup_id: 8 },
        { roster_id: 2, matchup_id: 8 },
      ]]]),
      projections: [
        { teamId: "a", week: 1, lineup, playerProjectedPpg: { qb: 20, rb: 15 } },
        { teamId: "b", week: 1, lineup, playerProjectedPpg: { qb: 20, rb: 15 } },
        { teamId: "a", week: 2, lineup, playerProjectedPpg: { qb: 20, rb: 15 } },
        { teamId: "b", week: 2, lineup: { ...lineup, projectedPpg: 30 }, playerProjectedPpg: { qb: 18, rb: 12 } },
      ],
      currentWeek: 2,
    });
    expect(rows[0]).toMatchObject({ completed: true, actualScore: 121, opponentActualScore: 110 });
    expect(rows[1]).toMatchObject({ completed: false, projectedScore: 35, opponentProjectedScore: 30, projectedWinnerId: "a" });
    expect(rows[1].lineupPlayerProjectedPpg).toEqual({ qb: 20, rb: 15 });
  });

  it("does not count a bye player in an optimized future lineup", () => {
    const lineup = optimizeProjectedLineup([
      { playerId: "bye-rb", position: "RB", projectedPpg: 0 },
      { playerId: "active-rb", position: "RB", projectedPpg: 11 },
    ], ["RB"]);
    expect(lineup.selectedPlayerIds).toEqual(["active-rb"]);
    expect(lineup.projectedPpg).toBe(11);
  });
});
