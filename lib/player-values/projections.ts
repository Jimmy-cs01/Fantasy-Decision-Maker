import { calculateProjectedFantasyPoints } from "../projections/scoring";
import { EARLY_SEASON_PRIOR } from "./config";
import { HISTORICAL_UPSIDE } from "./config";
import { calculateLeagueSeasonPoints } from "../fantasy/league-scoring";
import type { PlayerSeasonRow } from "../players/types";
import type {
  ProjectedStatLine,
  ProjectionConfidence,
} from "../projections/types";
import { VALUE_POSITIONS } from "./replacement";
import type { FantasyPosition, ValuePlayerProjection } from "./types";
import type { HistoricalValueContext } from "./types";

export interface CurrentDepthRole {
  playerId: string;
  position: string;
  depthPosition: string;
  depthRank: number;
  isStarter: boolean;
  team: string;
  sourceUpdatedAt: string;
}

export interface ValueProjectionRecord {
  player_id: string;
  season: number;
  week: number;
  projected_stats: ProjectedStatLine;
  final_projection_ppr?: number | null;
  model_projection_ppr?: number | null;
  projection_diagnostics?: Record<string, unknown> | null;
  residual_low: number;
  residual_high: number;
  confidence: ProjectionConfidence;
  players:
    | {
        id: string;
        full_name: string;
        position: string | null;
        sleeper_position: string | null;
        historical_position: string | null;
        team: string | null;
        headshot_url: string | null;
        sleeper_player_id: string | null;
        birth_date?: string | null;
        rookie_season?: number | null;
        draft_year?: number | null;
        draft_round?: number | null;
        draft_pick?: number | null;
        draft_status?: "drafted" | "undrafted" | "unknown" | null;
      }
    | Array<{
        id: string;
        full_name: string;
        position: string | null;
        sleeper_position: string | null;
        historical_position: string | null;
        team: string | null;
        headshot_url: string | null;
        sleeper_player_id: string | null;
        birth_date?: string | null;
        rookie_season?: number | null;
        draft_year?: number | null;
        draft_round?: number | null;
        draft_pick?: number | null;
        draft_status?: "drafted" | "undrafted" | "unknown" | null;
      }>
    | null;
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
  return (
    EARLY_SEASON_PRIOR.preseasonWeight *
    Math.max(0, 1 - currentSeasonGames / EARLY_SEASON_PRIOR.decayGames)
  );
}

export function stabilizeProjection(
  projectedPpg: number,
  prior: ProjectionPrior | undefined,
) {
  if (!prior || prior.games < EARLY_SEASON_PRIOR.minimumPriorGames) {
    return {
      ppg: projectedPpg,
      priorWeight: 0,
      priorSeasonPpg: prior?.ppg ?? null,
    };
  }
  const priorWeight = priorInfluence(prior.currentSeasonGames ?? 0);
  return {
    ppg: projectedPpg * (1 - priorWeight) + prior.ppg * priorWeight,
    priorWeight,
    priorSeasonPpg: prior.ppg,
  };
}

/** Builds position-relative, multi-season evidence without changing weekly projections. */
export function historicalValueContexts(
  rows: PlayerSeasonRow[],
  scoringSettings: Record<string, number>,
  projectionSeason: number,
) {
  const eligible = rows.flatMap((row) => {
    const position = row.historical_position?.toUpperCase() as FantasyPosition | undefined;
    const seasonsAgo = projectionSeason - Number(row.season);
    const games = Number(row.games_played ?? 0);
    if (
      !position ||
      !VALUE_POSITIONS.includes(position) ||
      seasonsAgo < 1 ||
      seasonsAgo > HISTORICAL_UPSIDE.seasonWeights.length ||
      games < HISTORICAL_UPSIDE.minimumSeasonGames
    ) return [];
    return [{
      playerId: row.player_id,
      season: Number(row.season),
      position,
      games,
      ppg: calculateLeagueSeasonPoints(row, scoringSettings) / games,
      recencyWeight: HISTORICAL_UPSIDE.seasonWeights[seasonsAgo - 1],
    }];
  });
  const cohorts = new Map<string, typeof eligible>();
  for (const season of eligible) {
    const key = `${season.season}:${season.position}`;
    cohorts.set(key, [...(cohorts.get(key) ?? []), season]);
  }
  const ranks = new Map<string, { rank: number; percentile: number }>();
  for (const [key, cohort] of cohorts) {
    const ordered = [...cohort].sort((left, right) => right.ppg - left.ppg || left.playerId.localeCompare(right.playerId));
    ordered.forEach((season, index) => ranks.set(`${key}:${season.playerId}`, {
      rank: index + 1,
      percentile: ordered.length <= 1 ? 1 : 1 - index / (ordered.length - 1),
    }));
  }
  const ranked = eligible.map((season) => {
    const result = ranks.get(`${season.season}:${season.position}:${season.playerId}`)!;
    return {
      ...season,
      positionRank: result.rank,
      positionPercentile: result.percentile,
    };
  });
  const byPlayer = new Map<string, typeof ranked>();
  for (const season of ranked) byPlayer.set(season.playerId, [...(byPlayer.get(season.playerId) ?? []), season]);
  return new Map([...byPlayer].map(([playerId, seasons]) => {
    const ordered = seasons.sort((left, right) => right.season - left.season);
    const weight = ordered.reduce((sum, season) => sum + season.recencyWeight, 0);
    const context: HistoricalValueContext = {
      seasons: ordered,
      weightedPpg: ordered.reduce((sum, season) => sum + season.ppg * season.recencyWeight, 0) / weight,
      weightedPositionPercentile: ordered.reduce((sum, season) => sum + season.positionPercentile * season.recencyWeight, 0) / weight,
      peakPpg: Math.max(...ordered.map((season) => season.ppg)),
      bestPositionRank: Math.min(...ordered.map((season) => season.positionRank)),
      highEndSeasonRate: ordered.filter((season) => season.positionPercentile >= HISTORICAL_UPSIDE.highEndPercentile).length / ordered.length,
      sampleGames: ordered.reduce((sum, season) => sum + season.games, 0),
    };
    return [playerId, context];
  }));
}

export function projectionPriors(
  historyRows: PlayerSeasonRow[],
  scoringSettings: Record<string, number>,
  projectionSeason: number,
) {
  const currentGames = new Map(historyRows.filter((row) => row.season === projectionSeason)
    .map((row) => [row.player_id, Number(row.games_played ?? 0)]));
  const byPlayer = new Map<string, Array<{ ppg: number; games: number; weight: number }>>();
  for (const row of historyRows) {
    const seasonsAgo = projectionSeason - row.season;
    if (seasonsAgo < 1 || seasonsAgo > EARLY_SEASON_PRIOR.recentSeasonWeights.length || !Number(row.games_played)) continue;
    const entries = byPlayer.get(row.player_id) ?? [];
    entries.push({
      ppg: calculateLeagueSeasonPoints(row, scoringSettings) / Number(row.games_played),
      games: Number(row.games_played),
      weight: EARLY_SEASON_PRIOR.recentSeasonWeights[seasonsAgo - 1],
    });
    byPlayer.set(row.player_id, entries);
  }
  return new Map([...new Set([...byPlayer.keys(), ...currentGames.keys()])].map((playerId) => {
    const entries = byPlayer.get(playerId) ?? [];
    const weight = entries.reduce((total, entry) => total + entry.weight, 0);
    return [playerId, {
      ppg: weight > 0 ? entries.reduce((total, entry) => total + entry.ppg * entry.weight, 0) / weight : 0,
      games: entries.reduce((total, entry) => total + entry.games, 0),
      currentSeasonGames: currentGames.get(playerId) ?? 0,
    }];
  }));
}

export function scoreProjectionPool(
  records: ValueProjectionRecord[],
  scoringSettings: Record<string, number>,
  priors: Map<string, ProjectionPrior> = new Map(),
  depthRoles: Map<string, CurrentDepthRole> = new Map(),
  historicalContexts: Map<string, HistoricalValueContext> = new Map(),
) {
  return records.flatMap((record): ValuePlayerProjection[] => {
    const player = projectionIdentity(record);
    const position = (
      player?.sleeper_position ??
      player?.position ??
      player?.historical_position
    )?.toUpperCase() as FantasyPosition | undefined;
    if (!player || !position || !VALUE_POSITIONS.includes(position)) return [];
    // projected_stats is the reconciled final component line. Scoring it here
    // supports custom leagues without adding Vegas or role context twice.
    const modelPpg = calculateProjectedFantasyPoints(
      record.projected_stats,
      scoringSettings,
      position,
    );
    const prior = priors.get(record.player_id);
    const stabilized = stabilizeProjection(modelPpg, prior);
    const shift = stabilized.ppg - modelPpg;
    const depth = depthRoles.get(record.player_id);
    return [
      {
        playerId: record.player_id,
        season: record.season,
        fullName: player.full_name,
        position,
        projectedPpg: stabilized.ppg,
        floorPpg: Math.max(0, modelPpg + Number(record.residual_low) + shift),
        ceilingPpg: Math.max(
          0,
          modelPpg + Number(record.residual_high) + shift,
        ),
        confidence: record.confidence,
        projectedStats: record.projected_stats,
        priorSeasonPpg: stabilized.priorSeasonPpg,
        priorWeight: stabilized.priorWeight,
        birthDate: player.birth_date ?? null,
        rookieSeason: player.rookie_season ?? null,
        historicalGames: (prior?.games ?? 0) + (prior?.currentSeasonGames ?? 0),
        draftYear: player.draft_year ?? null,
        draftRound: player.draft_round ?? null,
        draftPick: player.draft_pick ?? null,
        draftStatus: player.draft_status ?? null,
        depthPosition: depth?.depthPosition ?? null,
        depthRank: depth?.depthRank ?? null,
        depthStarter: depth?.isStarter ?? null,
        historicalContext: historicalContexts.get(record.player_id) ?? null,
      },
    ];
  });
}
