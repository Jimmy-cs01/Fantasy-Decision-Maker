import { calculateWeeklyAvailability } from "@/lib/injuries/availability";
import type { InjuryRecord } from "@/lib/injuries/types";
import { normalizeNflTeam } from "@/lib/nfl/teams";
import { normalizeProjection } from "./normalize";
import type { ProjectionConfidence, ProjectionRecord, ProjectionScoringContext } from "./types";

export const FANTASY_REGULAR_SEASON_WEEKS = 17;

export type ProjectionScheduleGame = {
  week: number;
  kickoff: string | null;
  home_team: string;
  away_team: string;
};

function confidenceForHorizon(confidence: ProjectionConfidence, weeksAhead: number): ProjectionConfidence {
  if (weeksAhead <= 3) return confidence;
  if (weeksAhead <= 7 && confidence === "high") return "medium";
  return weeksAhead >= 8 ? "low" : confidence;
}

function zeroRecord(record: ProjectionRecord, week: number, reason: string): ProjectionRecord {
  return {
    ...record,
    week,
    opponent_team: null,
    projected_stats: Object.fromEntries(Object.keys(record.projected_stats).map((key) => [key, 0])),
    model_projection_ppr: 0,
    opportunity_adjusted_ppr: 0,
    vegas_projection_ppr: null,
    sleeper_projection_ppr: null,
    final_projection_ppr: 0,
    projected_points_standard: 0,
    projected_points_half_ppr: 0,
    projected_points_ppr: 0,
    residual_low: 0,
    residual_high: 0,
    confidence: "high",
    drivers: [reason],
  };
}

function forecastRecord(record: ProjectionRecord, week: number, opponent: string, weeksAhead: number): ProjectionRecord {
  return {
    ...record,
    week,
    opponent_team: opponent,
    // Future markets are intentionally absent. The football components carry
    // current role/opportunity forward until a real weekly model run replaces them.
    vegas_projection_ppr: null,
    sleeper_projection_ppr: null,
    final_projection_ppr: null,
    vegas_confidence: null,
    blend_weight_model: null,
    confidence: confidenceForHorizon(record.confidence, weeksAhead),
    drivers: [...record.drivers.filter((driver) => !driver.toLowerCase().includes("vegas")), "Current role carried forward; future Vegas not fabricated"],
  };
}

export function currentProjectionWeek(games: ProjectionScheduleGame[], now = new Date()) {
  const weeks = [...new Set(games.map((game) => Number(game.week)).filter((week) => week >= 1 && week <= FANTASY_REGULAR_SEASON_WEEKS))].sort((a, b) => a - b);
  for (const week of weeks) {
    const kickoffs = games.filter((game) => Number(game.week) === week).map((game) => Date.parse(game.kickoff ?? "")).filter(Number.isFinite);
    if (!kickoffs.length || Math.max(...kickoffs) + 6 * 60 * 60 * 1000 >= now.getTime()) return week;
  }
  return weeks.at(-1) ?? 1;
}

export function buildSeasonProjectionHorizon(input: {
  records: ProjectionRecord[];
  games: ProjectionScheduleGame[];
  injury?: InjuryRecord | null;
  context: Omit<ProjectionScoringContext, "availability">;
  now?: Date;
}) {
  if (!input.records.length) return { currentWeek: 1, rows: [] };
  const now = input.now ?? new Date();
  const currentWeek = currentProjectionWeek(input.games, now);
  const records = new Map(input.records.map((record) => [Number(record.week), record]));
  const anchor = records.get(currentWeek)
    ?? [...input.records].sort((left, right) => Math.abs(left.week - currentWeek) - Math.abs(right.week - currentWeek))[0];
  const team = normalizeNflTeam(anchor.team ?? "");
  const rows = Array.from({ length: FANTASY_REGULAR_SEASON_WEEKS }, (_, index) => index + 1).map((week) => {
    const game = input.games.find((candidate) => Number(candidate.week) === week
      && [candidate.home_team, candidate.away_team].map((item) => normalizeNflTeam(item)).includes(team));
    const stored = records.get(week);
    const isTeamless = !team;
    const isBye = !isTeamless && !game;
    const opponent = game ? normalizeNflTeam(normalizeNflTeam(game.home_team) === team ? game.away_team : game.home_team) ?? null : null;
    const record = isBye || isTeamless
      ? zeroRecord(stored ?? anchor, week, isBye ? "NFL bye week" : "No current NFL team")
      : stored ?? forecastRecord(anchor, week, opponent ?? "", Math.max(0, week - currentWeek));
    const kickoff = game?.kickoff ?? null;
    const availability = isBye ? null : calculateWeeklyAvailability(
      input.injury,
      week,
      currentWeek,
      Math.max(0, FANTASY_REGULAR_SEASON_WEEKS - week + 1),
      now,
      kickoff,
    );
    return {
      projection: normalizeProjection(record, { ...input.context, availability }),
      isHome: game ? normalizeNflTeam(game.home_team) === team : null,
      kickoff,
      isBye,
      isForecast: !stored,
      isCurrent: week === currentWeek,
    };
  });
  return { currentWeek, rows };
}
