import { calculatePlayerValue, expectedGamesRemaining } from "./formula";
import { calculateReplacementProfiles } from "./replacement";
import type { PlayerValueResult, ValueLeagueConfig, ValuePlayerProjection } from "./types";

export function calculatePlayerValues(pool: ValuePlayerProjection[], config: ValueLeagueConfig, week: number) {
  const profiles = calculateReplacementProfiles(pool, config);
  const games = expectedGamesRemaining(week);
  const values = pool.map((player) => calculatePlayerValue(player, profiles[player.position], games));
  return { values: rankPlayerValues(values), profiles };
}

export function rankPlayerValues(values: PlayerValueResult[]) {
  const ordered = [...values].sort((left, right) => right.value - left.value || right.projectedPpg - left.projectedPpg || left.playerId.localeCompare(right.playerId));
  const positionCounts = new Map<string, number>();
  return ordered.map((player, index) => {
    const positionRank = (positionCounts.get(player.position) ?? 0) + 1;
    positionCounts.set(player.position, positionRank);
    return { ...player, overallRank: index + 1, positionRank };
  });
}

