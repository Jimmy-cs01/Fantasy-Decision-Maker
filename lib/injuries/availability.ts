import type { InjuryAvailability, InjuryRecord, InjuryStatus } from "./types";
import { projectionAbsencePolicy, unavailableForProjectionWeek } from "./policy";

export const INJURY_FRESHNESS_HOURS = 36;

/** 2018-2025 nflverse official reports joined to PFR offensive snaps (fantasy positions). */
export const HISTORICAL_ACTIVE_PROBABILITY = {
  questionable: { full: 0.716, limited: 0.632, dnp: 0.419, unknown: 0.615 },
  doubtful: 0.012,
  out: 0.001,
} as const;

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));

function practiceBucket(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("full")) return "full";
  if (normalized.includes("limited")) return "limited";
  if (normalized.includes("did not") || normalized === "dnp") return "dnp";
  return "unknown";
}

export function statusLabel(status: InjuryStatus) {
  return ({ healthy: "Healthy", questionable: "Questionable", doubtful: "Doubtful", out: "Out", ir: "IR", pup: "PUP", suspended: "Suspended", inactive: "Inactive", nfi: "NFI", unknown: "Status unknown" })[status];
}

export function activeProbability(record: InjuryRecord | null | undefined, now = new Date(), kickoff?: string | null) {
  if (!record || record.status === "healthy") return 1;
  const fetched = new Date(record.source_updated_at ?? record.fetched_at);
  const stale = !Number.isFinite(fetched.valueOf()) || now.valueOf() - fetched.valueOf() > INJURY_FRESHNESS_HOURS * 3_600_000;
  if (stale) return 1;
  const roster = String(record.roster_status ?? "").toLowerCase();
  const kickoffAt = kickoff ? new Date(kickoff) : null;
  const daysUntilKickoff = kickoffAt && Number.isFinite(kickoffAt.valueOf()) ? (kickoffAt.valueOf() - now.valueOf()) / 86_400_000 : null;
  // Questionable/Doubtful are game-week designations. Sleeper may carry them
  // through preseason without official practice context, so surface the badge
  // but do not reduce a future game until its decision window begins.
  const activeReserveLabel = ["ir", "pup"].includes(record.status) && roster.includes("active");
  if (daysUntilKickoff != null && daysUntilKickoff > 7 && (["questionable", "doubtful"].includes(record.status) || activeReserveLabel)) return 1;
  if (record.status === "questionable") return HISTORICAL_ACTIVE_PROBABILITY.questionable[practiceBucket(record.practice_participation)];
  if (record.status === "doubtful") return HISTORICAL_ACTIVE_PROBABILITY.doubtful;
  if (record.status === "out" || record.status === "inactive" || record.status === "suspended" || record.status === "nfi") return 0;
  if (record.status === "ir") return roster.includes("active") ? 0.25 : 0;
  if (record.status === "pup") return roster.includes("active") ? HISTORICAL_ACTIVE_PROBABILITY.questionable.unknown : 0;
  return 1;
}

export function availabilityTimeline(record: InjuryRecord | null | undefined) {
  if (!record) return "No injury designation";
  if (record.expected_return_date) return `${record.timeline_type === "reported" ? "Reported" : "Estimated"} return ${record.expected_return_date}`;
  const min = record.return_timeline_min_weeks;
  const max = record.return_timeline_max_weeks;
  if (min != null && max != null) return `Estimated to miss ${min}–${max} weeks`;
  if (record.expected_games_missed != null && !record.timeline_source?.includes("designation start date unavailable")) {
    if (record.expected_games_missed <= 1) return record.timeline_type === "reported" ? "Reported out this week" : "Estimated to miss about 1 game";
    return `Estimated to miss about ${record.expected_games_missed} games`;
  }
  if (record.status === "out" || record.status === "inactive") return "Reported out this week";
  return "Return timetable unknown";
}

export function calculateAvailability(
  record: InjuryRecord | null | undefined,
  gamesRemaining: number,
  now = new Date(),
  kickoff?: string | null,
): InjuryAvailability {
  const probability = activeProbability(record, now, kickoff);
  const updatedAt = record?.source_updated_at ?? record?.fetched_at ?? now.toISOString();
  const updated = new Date(updatedAt);
  const isStale = Boolean(record) && (!Number.isFinite(updated.valueOf()) || now.valueOf() - updated.valueOf() > INJURY_FRESHNESS_HOURS * 3_600_000);
  const absence = projectionAbsencePolicy(record);
  const currentWeekMiss = 1 - probability;
  const expectedGamesMissed = isStale ? 0 : clamp(Math.max(absence.weeks, currentWeekMiss), 0, gamesRemaining);
  return {
    status: record?.status ?? "healthy",
    statusLabel: statusLabel(record?.status ?? "healthy"),
    practiceParticipation: record?.practice_participation ?? null,
    injuryBodyPart: record?.injury_body_part ?? null,
    source: record?.source ?? "none",
    updatedAt,
    isStale,
    currentWeekActiveProbability: probability,
    expectedGamesMissed,
    expectedActiveGamesRemaining: Math.max(0, gamesRemaining - expectedGamesMissed),
    timelineType: record?.timeline_type ?? "unknown",
    timelineConfidence: record?.timeline_confidence ?? null,
    timelineLabel: availabilityTimeline(record),
    expectedReturnDate: record?.expected_return_date ?? null,
    projectionAssumption: isStale ? null : absence.label,
    projectionAssumptionBasis: isStale ? "none" : absence.basis,
  };
}

export function calculateWeeklyAvailability(
  record: InjuryRecord | null | undefined,
  targetWeek: number,
  currentWeek: number,
  gamesRemaining: number,
  now = new Date(),
  kickoff?: string | null,
) {
  const result = calculateAvailability(record, gamesRemaining, now, kickoff);
  if (result.isStale) return result;
  if (!unavailableForProjectionWeek(record, targetWeek, currentWeek, kickoff)) {
    if (targetWeek <= currentWeek) return result;
    return { ...result, currentWeekActiveProbability: 1 };
  }
  return {
    ...result,
    currentWeekActiveProbability: 0,
    expectedActiveGamesRemaining: Math.max(0, gamesRemaining - projectionAbsencePolicy(record).weeks),
  };
}

export function availabilityAdjustedPpg(activeGamePpg: number, availability: Pick<InjuryAvailability, "currentWeekActiveProbability"> | null | undefined) {
  return activeGamePpg * (availability?.currentWeekActiveProbability ?? 1);
}

/** Approximate a point-mass-at-zero plus active P20/P50/P80 mixture. */
export function availabilityAdjustedQuantile(
  quantile: 0.2 | 0.5 | 0.8,
  availability: Pick<InjuryAvailability, "currentWeekActiveProbability"> | null | undefined,
  activeFloor: number,
  activeMedian: number,
  activeCeiling: number,
) {
  const probability = availability?.currentWeekActiveProbability ?? 1;
  if (probability <= 0 || quantile <= 1 - probability) return 0;
  const activeQuantile = (quantile - (1 - probability)) / probability;
  if (activeQuantile <= 0.2) return activeFloor * (activeQuantile / 0.2);
  if (activeQuantile <= 0.5) return activeFloor + (activeMedian - activeFloor) * ((activeQuantile - 0.2) / 0.3);
  if (activeQuantile <= 0.8) return activeMedian + (activeCeiling - activeMedian) * ((activeQuantile - 0.5) / 0.3);
  return activeCeiling;
}
