import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import type { User } from "@supabase/supabase-js";
import { buildRegisteredAnalytics } from "./registered";

const now = new Date("2026-08-21T20:00:00.000Z");

function user(id: string, input: Partial<User> = {}): User {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: `${id}@example.com`,
    created_at: "2026-08-01T00:00:00.000Z",
    app_metadata: {},
    user_metadata: {},
    identities: [],
    ...input,
  } as User;
}

function build(overrides: Partial<Parameters<typeof buildRegisteredAnalytics>[0]> = {}) {
  return buildRegisteredAnalytics({
    users: [user("u1"), user("u2")],
    leagues: [],
    sleeperAccounts: [],
    yahooAccounts: [],
    activities: [],
    activityAvailable: true,
    now,
    ...overrides,
  });
}

describe("registered user analytics", () => {
  it("excludes anonymous Auth users and never derives accounts from guests or league members", () => {
    const result = build({
      users: [user("registered"), user("anonymous", { is_anonymous: true })],
      leagues: [{ id: "l1", owner_id: "registered", name: "League", provider: "sleeper", last_synced_at: null, updated_at: "2026-08-20T00:00:00.000Z" }],
    });
    expect(result.totalRegisteredUsers).toBe(1);
    expect(result.users.map((row) => row.id)).toEqual(["registered"]);
  });

  it("counts a registered user once when the account owns multiple leagues", () => {
    const result = build({
      leagues: [
        { id: "l1", owner_id: "u1", name: "First", provider: "sleeper", last_synced_at: "2026-08-19T00:00:00.000Z", updated_at: "2026-08-19T00:00:00.000Z" },
        { id: "l2", owner_id: "u1", name: "Second", provider: "yahoo", last_synced_at: "2026-08-20T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z" },
      ],
      yahooAccounts: [{ user_id: "u1" }],
    });
    expect(result.totalRegisteredUsers).toBe(2);
    expect(result.usersWithLeagues).toBe(1);
    expect(result.totalLeagueConnections).toBe(2);
    expect(result.users.find((row) => row.id === "u1")).toMatchObject({ leagueCount: 2, recentLeague: "Second", providers: ["sleeper", "yahoo"] });
  });

  it("uses deterministic rolling active and registration windows", () => {
    const result = build({
      users: [
        user("today", { created_at: "2026-08-21T01:00:00.000Z", last_sign_in_at: "2026-08-21T19:00:00.000Z" }),
        user("week", { created_at: "2026-08-16T00:00:00.000Z", last_sign_in_at: "2026-08-16T00:00:00.000Z" }),
        user("month", { created_at: "2026-08-02T00:00:00.000Z", last_sign_in_at: "2026-08-02T00:00:00.000Z" }),
        user("old", { created_at: "2026-01-01T00:00:00.000Z", last_sign_in_at: "2026-01-01T00:00:00.000Z" }),
      ],
    });
    expect(result).toMatchObject({
      newUsers24Hours: 1,
      newUsers7Days: 2,
      newUsers30Days: 3,
      activeUsers24Hours: 1,
      activeUsers7Days: 2,
      activeUsers30Days: 3,
    });
  });

  it("deduplicates feature users and sessions while handling missing metadata", () => {
    const result = build({
      users: [user("u1", { email: undefined, user_metadata: {} })],
      activities: [
        { user_id: "u1", session_id: "s1", path: "/players", feature_key: "Players", first_seen_at: "2026-08-21T10:00:00.000Z", last_seen_at: "2026-08-21T11:00:00.000Z" },
        { user_id: "u1", session_id: "s1", path: "/players/one", feature_key: "Players", first_seen_at: "2026-08-21T11:00:00.000Z", last_seen_at: "2026-08-21T12:00:00.000Z" },
        { user_id: "u1", session_id: "s2", path: "/players", feature_key: "Players", first_seen_at: "2026-08-21T13:00:00.000Z", last_seen_at: "2026-08-21T14:00:00.000Z" },
      ],
    });
    expect(result.features).toEqual([{ feature: "Players", registeredUsers: 1, sessions: 2, lastUsedAt: "2026-08-21T14:00:00.000Z" }]);
    expect(result.users[0]).toMatchObject({ displayName: "Registered user", email: null, featureSummary: ["Players"] });
    expect(Object.keys(result.users[0])).not.toContain("encrypted_password");
  });
});
