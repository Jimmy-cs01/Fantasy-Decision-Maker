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
  receptions_20_29_yards?: number | null; receptions_30_39_yards?: number | null; receptions_40_plus_yards?: number | null;
  receiving_touchdowns_40_plus_yards?: number | null; receiving_touchdowns_50_plus_yards?: number | null;
  rushes_40_plus_yards?: number | null; rushing_touchdowns_40_plus_yards?: number | null; rushing_touchdowns_50_plus_yards?: number | null;
  completions_40_plus_yards?: number | null; passing_touchdowns_40_plus_yards?: number | null; passing_touchdowns_50_plus_yards?: number | null;
}

export type ScoringSupport = "deterministic" | "expected" | "unsupported";

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

const LINEAR_SCORING_KEYS = new Set([
  ...Object.keys(STANDARD_BASELINE),
  "pass_cmp", "pass_att", "pass_inc", "pass_fd", "rush_att", "rush_fd", "rec_fd",
  "bonus_rec_qb", "bonus_rec_rb", "bonus_rec_wr", "bonus_rec_te", "bonus_rec_k",
]);

const EXPECTED_EVENT_SCORING_KEYS = new Set([
  "rec_20_29", "rec_30_39", "rec_40p", "rec_td_40p", "rec_td_50p",
  "rush_40p", "rush_td_40p", "rush_td_50p",
  "pass_cmp_40p", "pass_td_40p", "pass_td_50p",
]);

const NON_OFFENSIVE_PREFIXES = [
  "bonus_k_", "def_", "fgm_", "fgmiss_", "idp_", "kick_", "kr_", "pr_", "pts_allow_", "st_", "xpm", "xpmiss",
];

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
  points += value(row.receptions_20_29_yards) * value(settings.rec_20_29);
  points += value(row.receptions_30_39_yards) * value(settings.rec_30_39);
  points += value(row.receptions_40_plus_yards) * value(settings.rec_40p);
  points += value(row.receiving_touchdowns_40_plus_yards) * value(settings.rec_td_40p);
  points += value(row.receiving_touchdowns_50_plus_yards) * value(settings.rec_td_50p);
  points += value(row.rushes_40_plus_yards) * value(settings.rush_40p);
  points += value(row.rushing_touchdowns_40_plus_yards) * value(settings.rush_td_40p);
  points += value(row.rushing_touchdowns_50_plus_yards) * value(settings.rush_td_50p);
  points += value(row.completions_40_plus_yards) * value(settings.pass_cmp_40p);
  points += value(row.passing_touchdowns_40_plus_yards) * value(settings.pass_td_40p);
  points += value(row.passing_touchdowns_50_plus_yards) * value(settings.pass_td_50p);
  return Math.round(points * 100) / 100;
}

/**
 * Describes which non-zero offensive Sleeper settings can be translated from
 * Jimmy's component forecast. Expected-event settings require the separately
 * estimated, heavily regressed long-play fields above. Defense and kicking
 * settings are intentionally outside an offensive player projection audit.
 */
export function analyzeSleeperScoringCoverage(settings: SleeperScoringSettings) {
  const rows = Object.entries(settings)
    .filter(([, rate]) => value(rate) !== 0)
    .filter(([key]) => !NON_OFFENSIVE_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .map(([key, rate]) => ({
      key,
      rate: value(rate),
      support: (LINEAR_SCORING_KEYS.has(key)
        ? "deterministic"
        : EXPECTED_EVENT_SCORING_KEYS.has(key)
          ? "expected"
          : "unsupported") as ScoringSupport,
    }));
  const supported = rows.filter((row) => row.support !== "unsupported").length;
  return {
    settings: rows,
    supported,
    total: rows.length,
    coverage: rows.length ? supported / rows.length : 1,
    unsupported: rows.filter((row) => row.support === "unsupported").map((row) => row.key),
  };
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
