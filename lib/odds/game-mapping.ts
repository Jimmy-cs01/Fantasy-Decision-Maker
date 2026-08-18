import type { OddsGame } from "./types";

export interface CanonicalScheduleGame {
  id: string;
  home_team: string;
  away_team: string;
  kickoff: string | null;
}

export function matchOddsGameToSchedule(line: OddsGame, games: CanonicalScheduleGame[]) {
  const candidates = games.filter((game) => game.home_team === line.homeTeam && game.away_team === line.awayTeam);
  if (!candidates.length) return null;
  const kickoff = Date.parse(line.commenceTime);
  const ranked = candidates.map((game) => ({
    game,
    distance: game.kickoff && Number.isFinite(kickoff) ? Math.abs(Date.parse(game.kickoff) - kickoff) : 0,
  })).sort((left, right) => left.distance - right.distance);
  const best = ranked[0];
  return best.distance <= 36 * 60 * 60 * 1000 ? best.game : null;
}
