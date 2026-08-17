import { calculateProjectedFantasyPoints, scoringSettingsForMode } from "./scoring";
import type { ProjectionRecord, ProjectionResponse, ProjectionScoringContext } from "./types";

const round = (value: number) => Math.round(value * 10) / 10;
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

export function normalizeProjection(
  record: ProjectionRecord,
  context: ProjectionScoringContext,
): ProjectionResponse {
  const settings = context.mode === "league"
    ? context.settings ?? { rec: 1 }
    : scoringSettingsForMode(context.mode);
  const projectedPoints = calculateProjectedFantasyPoints(record.projected_stats, settings, context.position);
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
    projectedPoints: round(projectedPoints),
    floor: round(Math.max(0, projectedPoints + Number(record.residual_low))),
    median: round(projectedPoints),
    ceiling: round(Math.max(0, projectedPoints + Number(record.residual_high))),
    confidence: record.confidence,
    drivers: record.drivers,
    scoringMode: context.mode,
    modelVersion: modelVersion ?? "unknown",
  };
}

