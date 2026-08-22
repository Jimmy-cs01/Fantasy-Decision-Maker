import { describe, expect, it } from "vitest";
import { buildAnonymousAnalytics } from "./anonymous-metrics";

describe("guest and anonymous analytics", () => {
  it("counts stable visitors separately from sessions and activity events", () => {
    const result = buildAnonymousAnalytics([
      { anonymous_id: "11111111-1111-4111-8111-111111111111", visitor_type: "guest", first_seen: "2026-08-20T12:00:00Z", last_seen: "2026-08-21T12:00:00Z", session_count: 2, visit_count: 8, last_path: "/guest" },
      { anonymous_id: "22222222-2222-4222-8222-222222222222", visitor_type: "anonymous", first_seen: "2026-08-01T12:00:00Z", last_seen: "2026-08-10T12:00:00Z", session_count: 1, visit_count: 3, last_path: "/players" },
    ], new Date("2026-08-21T18:00:00Z"));
    expect(result).toMatchObject({ totalVisitors: 2, guestVisitors: 1, anonymousVisitors: 1, active24Hours: 1, totalSessions: 3, totalActivities: 11 });
    expect(result.visitors[0].visitorCode).toBe("11111111");
  });
});
