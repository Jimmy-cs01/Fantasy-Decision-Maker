import "server-only";

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type RegisteredLeague = {
  id: string;
  owner_id: string;
  name: string;
  provider: string | null;
  last_synced_at: string | null;
  updated_at: string;
};

export type RegisteredActivity = {
  user_id: string;
  session_id: string;
  path: string;
  feature_key: string;
  first_seen_at: string;
  last_seen_at: string;
};

type SleeperAccount = {
  user_id: string;
  username: string;
  display_name: string | null;
};

type YahooAccount = { user_id: string };

export type RegisteredUserRow = {
  id: string;
  displayName: string;
  email: string | null;
  signedUpAt: string;
  lastSignInAt: string | null;
  lastActivityAt: string | null;
  leagueCount: number;
  providers: string[];
  sleeperUsername: string | null;
  recentLeague: string | null;
  featureSummary: string[];
};

export type FeatureUsageRow = {
  feature: string;
  registeredUsers: number;
  sessions: number;
  lastUsedAt: string;
};

export type RegisteredAnalytics = {
  generatedAt: string;
  totalRegisteredUsers: number;
  newUsers24Hours: number;
  newUsers7Days: number;
  newUsers30Days: number;
  activeUsers24Hours: number;
  activeUsers7Days: number;
  activeUsers30Days: number;
  usersWithLeagues: number;
  usersWithoutLeagues: number;
  sleeperConnectedUsers: number;
  yahooConnectedUsers: number;
  totalLeagueConnections: number;
  users: RegisteredUserRow[];
  features: FeatureUsageRow[];
  activityAvailable: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isRegisteredUser(user: User) {
  return user.is_anonymous !== true;
}

function timestamp(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function latest(...values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort((a, b) => timestamp(b) - timestamp(a))[0] ?? null;
}

function displayName(user: User, sleeper: SleeperAccount | undefined) {
  const metadata = user.user_metadata ?? {};
  const candidate = sleeper?.display_name
    ?? metadata.display_name
    ?? metadata.full_name
    ?? metadata.name;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  return user.email?.split("@")[0] ?? "Registered user";
}

function within(value: string | null, nowMs: number, days: number) {
  const valueMs = timestamp(value);
  return valueMs !== Number.NEGATIVE_INFINITY && valueMs >= nowMs - days * DAY_MS && valueMs <= nowMs;
}

export function buildRegisteredAnalytics(input: {
  users: User[];
  leagues: RegisteredLeague[];
  sleeperAccounts: SleeperAccount[];
  yahooAccounts: YahooAccount[];
  activities: RegisteredActivity[];
  activityAvailable: boolean;
  now: Date;
}): RegisteredAnalytics {
  const users = input.users.filter(isRegisteredUser);
  const registeredIds = new Set(users.map((user) => user.id));
  const leaguesByUser = new Map<string, RegisteredLeague[]>();
  const activityByUser = new Map<string, RegisteredActivity[]>();
  const sleeperByUser = new Map(input.sleeperAccounts.filter((row) => registeredIds.has(row.user_id)).map((row) => [row.user_id, row]));
  const yahooUsers = new Set(input.yahooAccounts.filter((row) => registeredIds.has(row.user_id)).map((row) => row.user_id));

  for (const league of input.leagues) {
    if (!registeredIds.has(league.owner_id)) continue;
    leaguesByUser.set(league.owner_id, [...(leaguesByUser.get(league.owner_id) ?? []), league]);
  }
  for (const activity of input.activities) {
    if (!registeredIds.has(activity.user_id)) continue;
    activityByUser.set(activity.user_id, [...(activityByUser.get(activity.user_id) ?? []), activity]);
  }

  const rows = users.map((user): RegisteredUserRow => {
    const leagues = (leaguesByUser.get(user.id) ?? []).sort((a, b) => timestamp(b.last_synced_at ?? b.updated_at) - timestamp(a.last_synced_at ?? a.updated_at));
    const activities = activityByUser.get(user.id) ?? [];
    const featureLastUsed = new Map<string, string>();
    for (const activity of activities) {
      const current = featureLastUsed.get(activity.feature_key);
      if (!current || timestamp(activity.last_seen_at) > timestamp(current)) featureLastUsed.set(activity.feature_key, activity.last_seen_at);
    }
    const providers = [...new Set([
      ...leagues.map((league) => league.provider ?? "sleeper"),
      ...(sleeperByUser.has(user.id) ? ["sleeper"] : []),
      ...(yahooUsers.has(user.id) ? ["yahoo"] : []),
    ])].sort();
    const lastTrackedActivity = latest(...activities.map((activity) => activity.last_seen_at));
    const lastLeagueActivity = latest(...leagues.map((league) => league.last_synced_at ?? league.updated_at));
    return {
      id: user.id,
      displayName: displayName(user, sleeperByUser.get(user.id)),
      email: user.email ?? null,
      signedUpAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      lastActivityAt: latest(lastTrackedActivity, lastLeagueActivity, user.last_sign_in_at),
      leagueCount: leagues.length,
      providers,
      sleeperUsername: sleeperByUser.get(user.id)?.username ?? null,
      recentLeague: leagues[0]?.name ?? null,
      featureSummary: [...featureLastUsed.entries()].sort((a, b) => timestamp(b[1]) - timestamp(a[1])).slice(0, 3).map(([feature]) => feature),
    };
  }).sort((a, b) => timestamp(b.lastActivityAt) - timestamp(a.lastActivityAt) || a.displayName.localeCompare(b.displayName));

  const featureGroups = new Map<string, { users: Set<string>; sessions: Set<string>; lastUsedAt: string }>();
  for (const activity of input.activities) {
    if (!registeredIds.has(activity.user_id)) continue;
    const group = featureGroups.get(activity.feature_key) ?? { users: new Set<string>(), sessions: new Set<string>(), lastUsedAt: activity.last_seen_at };
    group.users.add(activity.user_id);
    group.sessions.add(`${activity.user_id}:${activity.session_id}`);
    if (timestamp(activity.last_seen_at) > timestamp(group.lastUsedAt)) group.lastUsedAt = activity.last_seen_at;
    featureGroups.set(activity.feature_key, group);
  }
  const features = [...featureGroups.entries()].map(([feature, group]) => ({
    feature,
    registeredUsers: group.users.size,
    sessions: group.sessions.size,
    lastUsedAt: group.lastUsedAt,
  })).sort((a, b) => b.registeredUsers - a.registeredUsers || b.sessions - a.sessions || a.feature.localeCompare(b.feature));

  const nowMs = input.now.getTime();
  const countNew = (days: number) => rows.filter((row) => within(row.signedUpAt, nowMs, days)).length;
  const countActive = (days: number) => rows.filter((row) => within(row.lastActivityAt, nowMs, days)).length;
  const sleeperConnectedUsers = new Set([
    ...input.sleeperAccounts.map((row) => row.user_id),
    ...input.leagues.filter((league) => (league.provider ?? "sleeper") === "sleeper").map((league) => league.owner_id),
  ].filter((id) => registeredIds.has(id))).size;

  return {
    generatedAt: input.now.toISOString(),
    totalRegisteredUsers: rows.length,
    newUsers24Hours: countNew(1),
    newUsers7Days: countNew(7),
    newUsers30Days: countNew(30),
    activeUsers24Hours: countActive(1),
    activeUsers7Days: countActive(7),
    activeUsers30Days: countActive(30),
    usersWithLeagues: rows.filter((row) => row.leagueCount > 0).length,
    usersWithoutLeagues: rows.filter((row) => row.leagueCount === 0).length,
    sleeperConnectedUsers,
    yahooConnectedUsers: yahooUsers.size,
    totalLeagueConnections: input.leagues.filter((league) => registeredIds.has(league.owner_id)).length,
    users: rows,
    features,
    activityAvailable: input.activityAvailable,
  };
}

async function listRegisteredAuthUsers() {
  const admin = createAdminClient();
  const users: User[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Unable to load registered users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users.filter(isRegisteredUser);
  }
}

function missingActivityTable(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205" || Boolean(error?.message?.includes("authenticated_user_activity"));
}

async function fetchAllRows<T>(table: string, columns: string) {
  const admin = createAdminClient();
  const rows: T[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const result = await admin.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (result.error) return { data: rows, error: result.error };
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

export async function getRegisteredAnalytics(now = new Date()) {
  const [users, leagues, sleeper, yahoo, activities] = await Promise.all([
    listRegisteredAuthUsers(),
    fetchAllRows<RegisteredLeague>("leagues", "id,owner_id,name,provider,last_synced_at,updated_at"),
    fetchAllRows<SleeperAccount>("sleeper_accounts", "user_id,username,display_name"),
    fetchAllRows<YahooAccount>("yahoo_accounts", "user_id"),
    fetchAllRows<RegisteredActivity>("authenticated_user_activity", "user_id,session_id,path,feature_key,first_seen_at,last_seen_at"),
  ]);
  const requiredError = leagues.error ?? sleeper.error ?? yahoo.error;
  if (requiredError) throw new Error(`Unable to load registered-user analytics: ${requiredError.message}`);
  if (activities.error && !missingActivityTable(activities.error)) throw new Error(`Unable to load authenticated activity: ${activities.error.message}`);
  return buildRegisteredAnalytics({
    users,
    leagues: leagues.data,
    sleeperAccounts: sleeper.data,
    yahooAccounts: yahoo.data,
    activities: activities.error ? [] : activities.data,
    activityAvailable: !activities.error,
    now,
  });
}

export async function getGuestAnalyticsSummary() {
  const admin = createAdminClient();
  const [visitors, sessions] = await Promise.all([
    admin.from("guest_visitors").select("anonymous_id", { count: "exact", head: true }),
    admin.from("guest_sessions").select("id", { count: "exact", head: true }),
  ]);
  const error = visitors.error ?? sessions.error;
  if (error) throw new Error(`Unable to load guest analytics: ${error.message}`);
  return { uniqueAnonymousBrowsers: visitors.count ?? 0, guestSessions: sessions.count ?? 0 };
}
