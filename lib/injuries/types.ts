export type InjuryStatus =
  | "healthy"
  | "questionable"
  | "doubtful"
  | "out"
  | "ir"
  | "pup"
  | "suspended"
  | "inactive"
  | "nfi"
  | "unknown";

export type TimelineType = "reported" | "estimated" | "unknown";
export type TimelineConfidence = "low" | "medium" | "high";

export interface InjuryRecord {
  player_id: string;
  team?: string | null;
  status: InjuryStatus;
  raw_status?: string | null;
  roster_status?: string | null;
  practice_participation?: string | null;
  practice_description?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
  expected_return_date?: string | null;
  expected_games_missed?: number | null;
  expected_weeks_missed?: number | null;
  return_timeline_min_weeks?: number | null;
  return_timeline_max_weeks?: number | null;
  timeline_confidence?: TimelineConfidence | null;
  timeline_source?: string | null;
  timeline_type?: TimelineType;
  source: string;
  source_updated_at?: string | null;
  fetched_at: string;
  updated_at?: string;
}

export interface InjuryAvailability {
  status: InjuryStatus;
  statusLabel: string;
  practiceParticipation: string | null;
  injuryBodyPart: string | null;
  source: string;
  updatedAt: string;
  isStale: boolean;
  currentWeekActiveProbability: number;
  expectedGamesMissed: number;
  expectedActiveGamesRemaining: number;
  timelineType: TimelineType;
  timelineConfidence: TimelineConfidence | null;
  timelineLabel: string;
  expectedReturnDate: string | null;
}
