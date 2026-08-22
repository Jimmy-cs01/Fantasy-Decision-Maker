import type { InjuryRecord, InjuryStatus } from "./types";

export const INJURY_PROJECTION_FALLBACK_WEEKS: Readonly<Partial<Record<InjuryStatus, number>>> = Object.freeze({
  questionable: 0,
  out: 1,
  pup: 4,
  ir: 4,
});

export type ProjectionAbsencePolicy = {
  weeks: number;
  basis: "reported" | "estimated" | "jimmygm_fallback" | "none";
  label: string | null;
};

function isLegacyFallback(record: InjuryRecord) {
  return record.timeline_source?.includes("designation start date unavailable") ?? false;
}

export function projectionAbsencePolicy(record: InjuryRecord | null | undefined): ProjectionAbsencePolicy {
  if (!record) return { weeks: 0, basis: "none", label: null };
  if (record.expected_return_date) {
    return {
      weeks: Math.max(0, Number(record.expected_weeks_missed ?? record.expected_games_missed ?? 0)),
      basis: record.timeline_type === "reported" ? "reported" : "estimated",
      label: record.timeline_type === "reported" ? "Reported return timetable" : "Estimated return timetable",
    };
  }
  if (!isLegacyFallback(record) && record.expected_games_missed != null) {
    return {
      weeks: Math.max(0, Number(record.expected_games_missed)),
      basis: record.timeline_type === "reported" ? "reported" : "estimated",
      label: record.timeline_type === "reported" ? "Reported absence" : "Estimated absence",
    };
  }
  const weeks = INJURY_PROJECTION_FALLBACK_WEEKS[record.status] ?? 0;
  return {
    weeks,
    basis: weeks > 0 ? "jimmygm_fallback" : "none",
    label: weeks > 0 ? `JimmyGM projection assumption: ${weeks} week${weeks === 1 ? "" : "s"}` : null,
  };
}

export function unavailableForProjectionWeek(
  record: InjuryRecord | null | undefined,
  targetWeek: number,
  currentWeek: number,
  kickoff?: string | null,
) {
  if (!record || targetWeek < currentWeek) return false;
  if (record.expected_return_date && kickoff) {
    const returnDate = Date.parse(`${record.expected_return_date}T00:00:00Z`);
    const kickoffDate = Date.parse(kickoff);
    if (Number.isFinite(returnDate) && Number.isFinite(kickoffDate)) return kickoffDate < returnDate;
  }
  const policy = projectionAbsencePolicy(record);
  return targetWeek - currentWeek < policy.weeks;
}
