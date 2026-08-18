import type { SleeperScoringSettings } from "../fantasy/league-scoring";

export type ProjectionConfidence = "high" | "medium" | "low";
export type ProjectionScoringMode = "league" | "standard" | "half_ppr" | "ppr";

export interface ProjectedStatLine {
  pass_attempts?: number;
  completions?: number;
  passing_yards?: number;
  passing_touchdowns?: number;
  interceptions_thrown?: number;
  passing_first_downs?: number;
  rush_attempts?: number;
  rushing_yards?: number;
  rushing_touchdowns?: number;
  rushing_first_downs?: number;
  targets?: number;
  receptions?: number;
  receiving_yards?: number;
  receiving_touchdowns?: number;
  receiving_first_downs?: number;
}

export interface ProjectionRecord {
  player_id: string;
  season: number;
  week: number;
  season_type: "REG" | "POST";
  team: string | null;
  opponent_team: string | null;
  projected_stats: ProjectedStatLine;
  model_projection_ppr: number | null;
  vegas_projection_ppr: number | null;
  final_projection_ppr: number | null;
  opportunity_adjusted_ppr?: number | null;
  sleeper_projection_ppr?: number | null;
  blend_weight_model?: number | null;
  vegas_confidence?: number | null;
  opportunity_confidence?: number | null;
  sanity_adjustment?: number | null;
  outlier_classification?: "normal" | "watch" | "large" | "extreme" | null;
  projection_diagnostics?: Record<string, unknown> | null;
  projected_points_standard: number;
  projected_points_half_ppr: number;
  projected_points_ppr: number;
  residual_low: number;
  residual_high: number;
  confidence: ProjectionConfidence;
  drivers: string[];
  model_versions: { version: string } | { version: string }[] | null;
}

export interface ProjectionResponse {
  playerId: string;
  season: number;
  week: number;
  seasonType: "REG" | "POST";
  team: string | null;
  opponent: string | null;
  stats: Record<string, number>;
  modelProjection: number | null;
  vegasProjection: number | null;
  opportunityAdjustedProjection: number | null;
  sleeperProjection: number | null;
  modelWeight: number | null;
  vegasConfidence: number | null;
  opportunityConfidence: number | null;
  sanityAdjustment: number | null;
  outlierClassification: "normal" | "watch" | "large" | "extreme" | null;
  diagnostics: Record<string, unknown> | null;
  projectedPoints: number;
  floor: number;
  median: number;
  ceiling: number;
  confidence: ProjectionConfidence;
  drivers: string[];
  scoringMode: ProjectionScoringMode;
  modelVersion: string;
}

export interface ProjectionScoringContext {
  mode: ProjectionScoringMode;
  settings?: SleeperScoringSettings;
  position?: string | null;
}
