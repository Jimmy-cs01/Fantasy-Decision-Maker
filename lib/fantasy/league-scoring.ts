import type { PlayerSeasonRow } from "@/lib/players/types";

export type SleeperScoringSettings = Record<string, number>;
export interface LeagueScoringStatLine {
  historical_position?: string | null;
  fantasy_points_standard?: number | null;
  passing_yards?: number | null; passing_touchdowns?: number | null; interceptions_thrown?: number | null;
  rushing_yards?: number | null; rushing_touchdowns?: number | null;
  receptions?: number | null; receiving_yards?: number | null; receiving_touchdowns?: number | null;
  completions?: number | null; pass_attempts?: number | null; passing_first_downs?: number | null; first_down_passes?: number | null;
  rush_attempts?: number | null; rushing_first_downs?: number | null; receiving_first_downs?: number | null;
}

const STANDARD_BASELINE = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec: 0,
  rec_yd: 0.1,
  rec_td: 6,
} as const;

const value = (input: unknown) => {
  const numeric = Number(input ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

/**
 * Applies Sleeper's supported linear offensive scoring rates to the nflverse
 * standard baseline. This preserves standard contributions that are not yet
 * normalized into season columns while replacing every supported rate with the
 * league's actual value.
 */
export function calculateLeagueSeasonPoints(row: LeagueScoringStatLine, settings: SleeperScoringSettings) {
  const position = row.historical_position?.toLowerCase();
  const positionReceptionBonus = position ? value(settings[`bonus_rec_${position}`]) : 0;
  let points = value(row.fantasy_points_standard);
  const adjustments: Array<[number, keyof typeof STANDARD_BASELINE]> = [
    [value(row.passing_yards), "pass_yd"],
    [value(row.passing_touchdowns), "pass_td"],
    [value(row.interceptions_thrown), "pass_int"],
    [value(row.rushing_yards), "rush_yd"],
    [value(row.rushing_touchdowns), "rush_td"],
    [value(row.receptions), "rec"],
    [value(row.receiving_yards), "rec_yd"],
    [value(row.receiving_touchdowns), "rec_td"],
  ];
  for (const [stat, key] of adjustments) {
    const leagueRate = Object.hasOwn(settings, key) ? value(settings[key]) : STANDARD_BASELINE[key];
    points += stat * (leagueRate - STANDARD_BASELINE[key]);
  }
  points += value(row.receptions) * positionReceptionBonus;
  points += value(row.completions) * value(settings.pass_cmp);
  points += value(row.pass_attempts) * value(settings.pass_att);
  points += Math.max(0, value(row.pass_attempts) - value(row.completions)) * value(settings.pass_inc);
  points += value(row.passing_first_downs ?? row.first_down_passes) * value(settings.pass_fd);
  points += value(row.rush_attempts) * value(settings.rush_att);
  points += value(row.rushing_first_downs) * value(settings.rush_fd);
  points += value(row.receiving_first_downs) * value(settings.rec_fd);
  return Math.round(points * 100) / 100;
}

export function withLeagueScoring(row: PlayerSeasonRow, settings: SleeperScoringSettings): PlayerSeasonRow {
  const points = calculateLeagueSeasonPoints(row, settings);
  const games = value(row.games_played);
  return {
    ...row,
    fantasy_points_league: points,
    fantasy_points_league_per_game: games ? points / games : null,
  };
}

export function withLeagueWeeklyScoring<T extends LeagueScoringStatLine>(row: T, settings: SleeperScoringSettings) {
  return { ...row, fantasy_points_league: calculateLeagueSeasonPoints(row, settings) };
}
