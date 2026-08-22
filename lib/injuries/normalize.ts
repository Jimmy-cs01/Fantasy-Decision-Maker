import type { SleeperPlayer } from "../sleeper/types";
import type { InjuryRecord, InjuryStatus } from "./types";

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export function normalizeInjuryStatus(rawStatus: unknown, rosterStatus: unknown): InjuryStatus {
  const raw = text(rawStatus)?.toLowerCase() ?? "";
  const roster = text(rosterStatus)?.toLowerCase() ?? "";
  if (roster.includes("injured reserve")) return "ir";
  if (roster.includes("physically unable")) return "pup";
  if (roster.includes("non football")) return "nfi";
  if (raw === "ir") return "ir";
  if (raw === "pup") return "pup";
  if (raw === "sus" || raw.includes("suspend")) return "suspended";
  if (raw === "out") return "out";
  if (raw === "doubtful") return "doubtful";
  if (raw === "questionable") return "questionable";
  if (roster === "inactive") return "inactive";
  if (!raw || ["na", "dnr", "cov"].includes(raw)) return "healthy";
  return "unknown";
}

export function normalizeSleeperInjury(
  playerId: string,
  player: SleeperPlayer,
  fetchedAt = new Date().toISOString(),
): InjuryRecord {
  const status = normalizeInjuryStatus(player.injury_status, player.status);
  return {
    player_id: playerId,
    team: text(player.team),
    status,
    raw_status: text(player.injury_status),
    roster_status: text(player.status),
    practice_participation: text(player.practice_participation),
    practice_description: text(player.practice_description),
    injury_body_part: text(player.injury_body_part),
    injury_notes: text(player.injury_notes),
    expected_return_date: null,
    expected_games_missed: null,
    expected_weeks_missed: null,
    return_timeline_min_weeks: null,
    return_timeline_max_weeks: null,
    timeline_confidence: status === "out" ? "high" : null,
    timeline_source: status === "out" ? "Sleeper game designation" : null,
    timeline_type: status === "out" ? "reported" : "unknown",
    source: "sleeper",
    source_updated_at: null,
    fetched_at: fetchedAt,
  };
}

export function injuryFingerprint(record: InjuryRecord) {
  return JSON.stringify([
    record.status, record.raw_status, record.roster_status,
    record.practice_participation, record.injury_body_part, record.injury_notes,
    record.expected_return_date, record.expected_games_missed,
  ]);
}
