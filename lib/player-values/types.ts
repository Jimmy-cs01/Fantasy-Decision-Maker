import type {
  ProjectionConfidence,
  ProjectedStatLine,
} from "../projections/types";
import type { InjuryAvailability } from "../injuries/types";

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
  activeGamePpg?: number;
  activeFloorPpg?: number;
  activeCeilingPpg?: number;
  availability?: InjuryAvailability | null;
  floorPpg: number;
  ceilingPpg: number;
  confidence: ProjectionConfidence;
  projectedStats?: ProjectedStatLine;
  priorSeasonPpg?: number | null;
  priorWeight?: number;
  birthDate?: string | null;
  rookieSeason?: number | null;
  historicalGames?: number;
  draftYear?: number | null;
  draftRound?: number | null;
  draftPick?: number | null;
  draftStatus?: "drafted" | "undrafted" | "unknown" | null;
  depthPosition?: string | null;
  depthRank?: number | null;
  depthStarter?: boolean | null;
  historicalContext?: HistoricalValueContext | null;
}

export interface HistoricalSeasonSignal {
  season: number;
  games: number;
  ppg: number;
  positionRank: number;
  positionPercentile: number;
  recencyWeight: number;
}

export interface HistoricalValueContext {
  seasons: HistoricalSeasonSignal[];
  weightedPpg: number;
  weightedPositionPercentile: number;
  peakPpg: number;
  bestPositionRank: number | null;
  highEndSeasonRate: number;
  sampleGames: number;
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
  /** Current/ROS football production translated through league replacement. */
  productionValue: number;
  /** Jimmy's projection-led value including future/role context. */
  fundamentalValue: number;
  /** Increment from age, draft, role runway, and proven historical ceiling. */
  futureAssetAdjustment: number;
  /** Reserved for an independently sourced market signal; null is not zero. */
  marketValue: number | null;
  /** Fundamental minus market when an independent market signal exists. */
  jimmyEdge: number | null;
  tier: string;
  projectedPpg: number;
  activeGamePpg: number;
  healthyValue: number;
  availabilityAdjustment: number;
  healthyExpectedGamesRemaining: number;
  injuryStatus: InjuryAvailability["status"];
  injuryStatusLabel: string;
  injuryTimeline: string;
  practiceParticipation: string | null;
  currentWeekActiveProbability: number;
  injuryDataStale: boolean;
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
  draftAdjustment: number;
  rookieProtectionAdjustment: number;
  historicalUpsideAdjustment: number;
  historicalWeightedPpg: number | null;
  historicalBestPositionRank: number | null;
  historicalSeasons: number;
  opportunityConfidence: number;
  draftLabel: string | null;
  depthRole: string | null;
  overallRank: number;
  positionRank: number;
}

export interface CombinedPlayerValue {
  playerId: string;
  general: PlayerValueResult;
  league: PlayerValueResult | null;
}
