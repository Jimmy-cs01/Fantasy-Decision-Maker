import type { AnonymousVisitorType } from "./guest";

export type AnonymousVisitorRecord = {
  anonymous_id: string;
  visitor_type?: AnonymousVisitorType | null;
  first_seen: string;
  last_seen: string;
  session_count: number;
  visit_count: number;
  last_path: string | null;
};

export type AnonymousVisitorRow = {
  visitorCode: string;
  visitorType: AnonymousVisitorType;
  firstSeen: string;
  lastSeen: string;
  sessionCount: number;
  activityCount: number;
  lastPath: string | null;
};

export type AnonymousAnalytics = {
  totalVisitors: number;
  guestVisitors: number;
  anonymousVisitors: number;
  active24Hours: number;
  active7Days: number;
  active30Days: number;
  totalSessions: number;
  totalActivities: number;
  visitors: AnonymousVisitorRow[];
};

const DAY_MS = 86_400_000;

function within(value: string, now: Date, days: number) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= now.getTime() - days * DAY_MS && parsed <= now.getTime();
}

export function buildAnonymousAnalytics(records: AnonymousVisitorRecord[], now: Date): AnonymousAnalytics {
  const visitors = records.map((record): AnonymousVisitorRow => ({
    visitorCode: record.anonymous_id.slice(0, 8),
    visitorType: record.visitor_type === "guest" ? "guest" : "anonymous",
    firstSeen: record.first_seen,
    lastSeen: record.last_seen,
    sessionCount: Number(record.session_count ?? 0),
    activityCount: Number(record.visit_count ?? 0),
    lastPath: record.last_path,
  })).sort((left, right) => Date.parse(right.lastSeen) - Date.parse(left.lastSeen));

  return {
    totalVisitors: visitors.length,
    guestVisitors: visitors.filter((row) => row.visitorType === "guest").length,
    anonymousVisitors: visitors.filter((row) => row.visitorType === "anonymous").length,
    active24Hours: visitors.filter((row) => within(row.lastSeen, now, 1)).length,
    active7Days: visitors.filter((row) => within(row.lastSeen, now, 7)).length,
    active30Days: visitors.filter((row) => within(row.lastSeen, now, 30)).length,
    totalSessions: visitors.reduce((sum, row) => sum + row.sessionCount, 0),
    totalActivities: visitors.reduce((sum, row) => sum + row.activityCount, 0),
    visitors,
  };
}
