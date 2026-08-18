export const PROJECTION_APPLY_REQUIRED_FIELDS = [
  "id",
  "player_id",
  "model_version_id",
  "season",
  "week",
] as const;

export interface ProjectionApplySource {
  id: unknown;
  player_id: unknown;
  model_version_id: unknown;
  season: unknown;
  week: unknown;
  season_type: unknown;
  team: unknown;
  opponent_team: unknown;
}

export type ProjectionApplyRow = Record<string, unknown> & {
  id: unknown;
  player_id: unknown;
  model_version_id: unknown;
  season: unknown;
  week: unknown;
  season_type: unknown;
  team: unknown;
  opponent_team: unknown;
};

export interface ProjectionApplyTarget {
  modelVersionId: string;
  season: number;
  week: number;
  seasonType: string;
}

export interface InvalidProjectionApplyRow {
  index: number;
  projectionId: string | null;
  playerId: string | null;
  missingFields: string[];
  contextMismatches: string[];
}

export function buildProjectionApplyRow<T extends Record<string, unknown>>(
  source: ProjectionApplySource,
  reconciledFields: T,
): ProjectionApplyRow & T {
  return {
    id: source.id,
    player_id: source.player_id,
    model_version_id: source.model_version_id,
    season: source.season,
    week: source.week,
    season_type: source.season_type,
    team: source.team,
    opponent_team: source.opponent_team,
    ...reconciledFields,
  };
}

const present = (value: unknown) => value !== null && value !== undefined && value !== "";

export function validateProjectionApplyRows(
  rows: ProjectionApplyRow[],
  expectedCount: number,
  target: ProjectionApplyTarget,
) {
  const invalidRows: InvalidProjectionApplyRow[] = [];
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();

  rows.forEach((row, index) => {
    const missingFields = PROJECTION_APPLY_REQUIRED_FIELDS.filter((field) => !present(row[field]));
    const contextMismatches: string[] = [];
    if (row.model_version_id !== target.modelVersionId) contextMismatches.push("model_version_id");
    if (Number(row.season) !== target.season) contextMismatches.push("season");
    if (Number(row.week) !== target.week) contextMismatches.push("week");
    if (row.season_type !== target.seasonType) contextMismatches.push("season_type");
    const id = present(row.id) ? String(row.id) : null;
    if (id && seenIds.has(id)) duplicateIds.add(id);
    if (id) seenIds.add(id);
    if (missingFields.length || contextMismatches.length) {
      invalidRows.push({
        index,
        projectionId: id,
        playerId: present(row.player_id) ? String(row.player_id) : null,
        missingFields: [...missingFields],
        contextMismatches,
      });
    }
  });

  return {
    reconciledRows: expectedCount,
    validRows: rows.length - invalidRows.length,
    invalidRows,
    duplicateIds: [...duplicateIds],
    countMatches: rows.length === expectedCount,
    safe: rows.length === expectedCount && invalidRows.length === 0 && duplicateIds.size === 0,
  };
}

export function describeInvalidProjectionApplyRow(row: InvalidProjectionApplyRow) {
  const problems = [
    row.missingFields.length ? `missing fields: ${row.missingFields.join(", ")}` : null,
    row.contextMismatches.length ? `wrong target fields: ${row.contextMismatches.join(", ")}` : null,
  ].filter(Boolean).join("; ");
  return `projection id: ${row.projectionId ?? "—"}; player id: ${row.playerId ?? "—"}; ${problems}`;
}
