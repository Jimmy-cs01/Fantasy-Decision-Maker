import type { ProjectionConfidence, ProjectedStatLine } from "../projections/types";

export type FantasyPosition = "QB" | "RB" | "WR" | "TE";

export interface ValueLeagueConfig {
  teams: number;
  rosterPositions: string[];
  scoringSettings: Record<string, number>;
}

export interface ValuePlayerProjection {
  playerId: string;
  season?: number;
  fullName: string;
  position: FantasyPosition;
  projectedPpg: number;
  floorPpg: number;
  ceilingPpg: number;
  confidence: ProjectionConfidence;
  projectedStats?: ProjectedStatLine;
  priorSeasonPpg?: number | null;
  priorWeight?: number;
  birthDate?: string | null;
  rookieSeason?: number | null;
  depthPosition?: string | null;
  depthRank?: number | null;
  depthStarter?: boolean | null;
}

export interface PositionReplacementProfile {
  position: FantasyPosition;
  demandedPlayers: number;
  replacementPpg: number;
  starterPpg: number;
  elitePpg: number;
  scarcityDropoff: number;
  demandPerTeam: number;
}

export interface PlayerValueResult {
  playerId: string;
  fullName: string;
  position: FantasyPosition;
  value: number;
  tier: string;
  projectedPpg: number;
  replacementPpg: number;
  vorpPerGame: number;
  rosVorp: number;
  rawValue: number;
  floorValue: number;
  medianValue: number;
  ceilingValue: number;
  confidence: ProjectionConfidence;
  expectedGamesRemaining: number;
  priorSeasonPpg: number | null;
  priorWeight: number;
  ageAdjustment: number;
  depthAdjustment: number;
  depthRole: string | null;
  overallRank: number;
  positionRank: number;
}

export interface CombinedPlayerValue {
  playerId: string;
  general: PlayerValueResult;
  league: PlayerValueResult | null;
}
