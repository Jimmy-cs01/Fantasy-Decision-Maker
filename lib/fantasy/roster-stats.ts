import { calculateLeagueSeasonPoints, type LeagueScoringStatLine, type SleeperScoringSettings } from "./league-scoring";

export interface RosterSeasonStatLine extends LeagueScoringStatLine {
  player_id: string;
  games_played: number | null;
  fantasy_points_ppr_per_game: number | null;
}

export function latestCompletedSeason(seasons: number[], currentYear = new Date().getFullYear()) {
  const completed = seasons.filter((season) => Number.isInteger(season) && season < currentYear);
  return completed.length ? Math.max(...completed) : null;
}

export function rosterPlayerPpg(
  row: RosterSeasonStatLine | null | undefined,
  scoringSettings?: SleeperScoringSettings | null,
) {
  if (!row || !row.games_played) return null;
  if (scoringSettings && Object.keys(scoringSettings).length > 0) {
    return calculateLeagueSeasonPoints(row, scoringSettings) / row.games_played;
  }
  const ppr = Number(row.fantasy_points_ppr_per_game);
  return Number.isFinite(ppr) ? ppr : null;
}

