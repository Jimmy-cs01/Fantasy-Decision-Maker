import { calculateLeagueSeasonPoints, type SleeperScoringSettings } from "../fantasy/league-scoring";
import type { PlayerSeasonRow } from "./types";

/** Final positional finish is regular-season total fantasy points, not PPG. */
export function calculateHistoricalPositionFinishes(
  rows: PlayerSeasonRow[],
  playerId: string,
  scoringSettings: SleeperScoringSettings,
) {
  const bySeason = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows) bySeason.set(Number(row.season), [...(bySeason.get(Number(row.season)) ?? []), row]);
  return new Map([...bySeason].flatMap(([season, cohort]) => {
    const ranked = cohort.sort((left, right) =>
      calculateLeagueSeasonPoints(right, scoringSettings) - calculateLeagueSeasonPoints(left, scoringSettings)
      || left.player_id.localeCompare(right.player_id));
    const rank = ranked.findIndex((row) => row.player_id === playerId) + 1;
    return rank > 0 ? [[season, rank] as const] : [];
  }));
}
