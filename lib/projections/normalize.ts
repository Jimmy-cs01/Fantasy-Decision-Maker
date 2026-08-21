import { activeGameProjectionPoints, displayedProjectionPoints } from "./presentation";
import { availabilityAdjustedQuantile } from "../injuries/availability";
import type { ProjectionRecord, ProjectionResponse, ProjectionScoringContext } from "./types";

const round = (value: number) => Math.round(value * 10) / 10;
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

export function normalizeProjection(
  record: ProjectionRecord,
  context: ProjectionScoringContext,
): ProjectionResponse {
  const projectedPoints = displayedProjectionPoints({
    stats: record.projected_stats,
    position: context.position,
    mode: context.mode,
    leagueSettings: context.settings,
    availability: context.availability,
  });
  const activeGameProjectedPoints = activeGameProjectionPoints({
    stats: record.projected_stats,
    position: context.position,
    mode: context.mode,
    leagueSettings: context.settings,
  });
  const activeFloor = Math.max(0, activeGameProjectedPoints + Number(record.residual_low));
  const activeCeiling = Math.max(0, activeGameProjectedPoints + Number(record.residual_high));
  const modelVersion = Array.isArray(record.model_versions)
    ? record.model_versions[0]?.version
    : record.model_versions?.version;
  return {
    playerId: record.player_id,
    season: record.season,
    week: record.week,
    seasonType: record.season_type,
    team: record.team,
    opponent: record.opponent_team,
    stats: Object.fromEntries(Object.entries(record.projected_stats).map(([key, value]) => [camel(key), round(Number(value))])),
    modelProjection: record.model_projection_ppr === null ? null : round(Number(record.model_projection_ppr)),
    vegasProjection: record.vegas_projection_ppr === null ? null : round(Number(record.vegas_projection_ppr)),
    opportunityAdjustedProjection: record.opportunity_adjusted_ppr == null ? null : round(Number(record.opportunity_adjusted_ppr)),
    sleeperProjection: record.sleeper_projection_ppr == null ? null : round(Number(record.sleeper_projection_ppr)),
    modelWeight: record.blend_weight_model == null ? null : Number(record.blend_weight_model),
    vegasConfidence: record.vegas_confidence == null ? null : Number(record.vegas_confidence),
    opportunityConfidence: record.opportunity_confidence == null ? null : Number(record.opportunity_confidence),
    sanityAdjustment: record.sanity_adjustment == null ? null : round(Number(record.sanity_adjustment)),
    outlierClassification: record.outlier_classification ?? null,
    diagnostics: record.projection_diagnostics ?? null,
    projectedPoints: round(projectedPoints),
    activeGameProjectedPoints: round(activeGameProjectedPoints),
    availability: context.availability ?? null,
    floor: round(availabilityAdjustedQuantile(0.2, context.availability, activeFloor, activeGameProjectedPoints, activeCeiling)),
    median: round(projectedPoints),
    ceiling: round(availabilityAdjustedQuantile(0.8, context.availability, activeFloor, activeGameProjectedPoints, activeCeiling)),
    confidence: record.confidence,
    drivers: record.drivers,
    scoringMode: context.mode,
    modelVersion: modelVersion ?? "unknown",
  };
}
