const MODEL_VERSION_PATTERN = /^v\d+(?:[._]\d+)*$/;

export const DEFAULT_ACTIVE_PROJECTION_MODEL_VERSION = "v2";

export function resolveActiveProjectionModelVersion(
  configured = process.env.ACTIVE_PROJECTION_MODEL_VERSION,
): string {
  const value = configured?.trim() || DEFAULT_ACTIVE_PROJECTION_MODEL_VERSION;
  if (!MODEL_VERSION_PATTERN.test(value)) {
    throw new Error("ACTIVE_PROJECTION_MODEL_VERSION must be a version such as v2 or v3_3.");
  }
  return value;
}

export interface VersionedProjection {
  generated_at: string;
  model_versions?: { version?: string | null } | Array<{ version?: string | null }> | null;
}

function recordVersion(record: VersionedProjection): string | null {
  const related = Array.isArray(record.model_versions)
    ? record.model_versions[0]
    : record.model_versions;
  return related?.version ?? null;
}

export function selectActiveProjection<T extends VersionedProjection>(
  records: T[],
  activeVersion = resolveActiveProjectionModelVersion(),
): T | null {
  return records
    .filter((record) => recordVersion(record) === activeVersion)
    .sort((left, right) => right.generated_at.localeCompare(left.generated_at))[0] ?? null;
}
