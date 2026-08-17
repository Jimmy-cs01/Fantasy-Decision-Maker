import { calculateProjectedFantasyPoints } from "../projections/scoring";
import { EARLY_SEASON_PRIOR } from "./config";
import type { ProjectedStatLine, ProjectionConfidence } from "../projections/types";
import { VALUE_POSITIONS } from "./replacement";
import type { FantasyPosition, ValuePlayerProjection } from "./types";

export interface ValueProjectionRecord {
  player_id: string;
  season: number;
  week: number;
  projected_stats: ProjectedStatLine;
  residual_low: number;
  residual_high: number;
  confidence: ProjectionConfidence;
  players: {
    id: string;
    full_name: string;
    position: string | null;
    sleeper_position: string | null;
    historical_position: string | null;
    team: string | null;
    headshot_url: string | null;
    sleeper_player_id: string | null;
  } | Array<{
    id: string;
    full_name: string;
    position: string | null;
    sleeper_position: string | null;
    historical_position: string | null;
    team: string | null;
    headshot_url: string | null;
    sleeper_player_id: string | null;
  }> | null;
}

export function projectionIdentity(record: ValueProjectionRecord) {
  return Array.isArray(record.players) ? record.players[0] : record.players;
}

export interface ProjectionPrior {
  ppg: number;
  games: number;
  currentSeasonGames?: number;
}

export function priorInfluence(currentSeasonGames: number) {
  return EARLY_SEASON_PRIOR.preseasonWeight
    * Math.max(0, 1 - currentSeasonGames / EARLY_SEASON_PRIOR.decayGames);
}

export function stabilizeProjection(projectedPpg: number, prior: ProjectionPrior | undefined) {
  if (!prior || prior.games < EARLY_SEASON_PRIOR.minimumPriorGames) {
    return { ppg: projectedPpg, priorWeight: 0, priorSeasonPpg: prior?.ppg ?? null };
  }
  const priorWeight = priorInfluence(prior.currentSeasonGames ?? 0);
  return {
    ppg: projectedPpg * (1 - priorWeight) + prior.ppg * priorWeight,
    priorWeight,
    priorSeasonPpg: prior.ppg,
  };
}

export function scoreProjectionPool(
  records: ValueProjectionRecord[],
  scoringSettings: Record<string, number>,
  priors: Map<string, ProjectionPrior> = new Map(),
) {
  return records.flatMap((record): ValuePlayerProjection[] => {
    const player = projectionIdentity(record);
    const position = (player?.sleeper_position ?? player?.position ?? player?.historical_position)?.toUpperCase() as FantasyPosition | undefined;
    if (!player || !position || !VALUE_POSITIONS.includes(position)) return [];
    const modelPpg = calculateProjectedFantasyPoints(record.projected_stats, scoringSettings, position);
    const stabilized = stabilizeProjection(modelPpg, priors.get(record.player_id));
    const shift = stabilized.ppg - modelPpg;
    return [{
      playerId: record.player_id,
      fullName: player.full_name,
      position,
      projectedPpg: stabilized.ppg,
      floorPpg: Math.max(0, modelPpg + Number(record.residual_low) + shift),
      ceilingPpg: Math.max(0, modelPpg + Number(record.residual_high) + shift),
      confidence: record.confidence,
      projectedStats: record.projected_stats,
      priorSeasonPpg: stabilized.priorSeasonPpg,
      priorWeight: stabilized.priorWeight,
    }];
  });
}
