import defenseData from "./defense-vs-position-2025.json";
import { normalizeNflTeam } from "../nfl/teams";
import { calculateProjectedFantasyPoints } from "./scoring";
import type { ProjectedStatLine, ProjectionRecord } from "./types";

export type FantasyPosition = "QB" | "RB" | "WR" | "TE";

export interface OpponentStrength {
  season: number;
  position: FantasyPosition;
  opponent: string;
  pointsAllowedPerGame: number;
  leagueAverage: number;
  rank: number;
  adjustmentPpg: number;
  softCapPpg: number;
}

type DefenseRow = {
  points_allowed_per_game: number;
  games: number;
  rank: number;
  normalized_factor: number;
  adjustment_ppg: number;
};

type PositionData = {
  league_average: number;
  soft_cap_ppg: number;
  prior_games: number;
  year_over_year_correlation: number | null;
  defenses: Record<string, DefenseRow>;
};

const dataset = defenseData as {
  season: number;
  positions: Record<FantasyPosition, PositionData>;
};

export function opponentStrength(position: string | null | undefined, opponent: string | null | undefined): OpponentStrength | null {
  const normalizedPosition = position?.toUpperCase() as FantasyPosition | undefined;
  const normalizedOpponent = normalizeNflTeam(opponent ?? "");
  if (!normalizedPosition || !normalizedOpponent || !dataset.positions[normalizedPosition]) return null;
  const positionData = dataset.positions[normalizedPosition];
  const defense = positionData.defenses[normalizedOpponent];
  if (!defense) return null;
  return {
    season: dataset.season,
    position: normalizedPosition,
    opponent: normalizedOpponent,
    pointsAllowedPerGame: defense.points_allowed_per_game,
    leagueAverage: positionData.league_average,
    rank: defense.rank,
    adjustmentPpg: defense.adjustment_ppg,
    softCapPpg: positionData.soft_cap_ppg,
  };
}

function applyPprDelta(stats: ProjectedStatLine, position: FantasyPosition, delta: number) {
  if (Math.abs(delta) < 1e-9) return { ...stats };
  const output = { ...stats };
  const sink: keyof ProjectedStatLine = position === "QB"
    ? "passing_yards"
    : position === "RB"
      ? "rushing_yards"
      : "receiving_yards";
  output[sink] = Math.max(0, Number(output[sink] ?? 0) + delta / (position === "QB" ? 0.04 : 0.1));
  return output;
}

/**
 * v4.1 already contains its seed-week opponent features. The weekly horizon
 * therefore applies only the difference between the seed matchup and the
 * requested matchup. This preserves the current projection exactly and avoids
 * counting opponent strength twice.
 */
export function applyRelativeOpponentAdjustment(input: {
  record: ProjectionRecord;
  position?: string | null;
  opponent?: string | null;
  anchorOpponent?: string | null;
}): ProjectionRecord {
  if (input.record.projection_diagnostics?.opponentAdjustmentMethod === "relative_to_seed_matchup") {
    return { ...input.record, opponent_team: input.opponent ?? input.record.opponent_team };
  }
  const normalizedPosition = input.position?.toUpperCase() as FantasyPosition | undefined;
  const current = opponentStrength(normalizedPosition, input.opponent);
  const anchor = opponentStrength(normalizedPosition, input.anchorOpponent);
  if (!normalizedPosition || !current || !anchor) {
    return { ...input.record, opponent_team: input.opponent ?? input.record.opponent_team };
  }
  const delta = Math.max(-current.softCapPpg, Math.min(current.softCapPpg, current.adjustmentPpg - anchor.adjustmentPpg));
  const basePpr = calculateProjectedFantasyPoints(input.record.projected_stats, { rec: 1 }, normalizedPosition);
  const stats = applyPprDelta(input.record.projected_stats, normalizedPosition, delta);
  const finalPpr = calculateProjectedFantasyPoints(stats, { rec: 1 }, normalizedPosition);
  return {
    ...input.record,
    opponent_team: current.opponent,
    projected_stats: stats,
    projected_points_standard: calculateProjectedFantasyPoints(stats, { rec: 0 }, normalizedPosition),
    projected_points_half_ppr: calculateProjectedFantasyPoints(stats, { rec: 0.5 }, normalizedPosition),
    projected_points_ppr: finalPpr,
    projection_diagnostics: {
      ...(input.record.projection_diagnostics ?? {}),
      baseProjectionPpr: basePpr,
      opponentAdjustmentPpg: finalPpr - basePpr,
      opponentDefenseRank: current.rank,
      opponentDefenseMetric: current.pointsAllowedPerGame,
      opponentDefenseLeagueAverage: current.leagueAverage,
      opponentDefenseSeason: current.season,
      opponentAdjustmentMethod: "relative_to_seed_matchup",
    },
  };
}
