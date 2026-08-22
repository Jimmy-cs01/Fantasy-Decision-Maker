export const GUEST_BROWSER_ID_KEY = "jimmy-gm:anonymous-browser:v1";
export const GUEST_ANALYTICS_SESSION_KEY = "jimmy-gm:anonymous-session:v1";
export const ANALYTICS_LAST_EVENT_KEY = "jimmy-gm:analytics-last-event:v1";

export type AnonymousVisitorType = "guest" | "anonymous";

export function validAnonymousId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getOrCreateAnonymousId(storage: Pick<Storage, "getItem" | "setItem">, key: string, create = () => crypto.randomUUID()) {
  const current = storage.getItem(key);
  if (validAnonymousId(current)) return current;
  const next = create();
  storage.setItem(key, next);
  return next;
}

export function anonymousVisitorType(pathname: string): AnonymousVisitorType {
  return pathname === "/guest" || pathname.startsWith("/guest/") ? "guest" : "anonymous";
}

export function normalizedAnonymousPath(pathname: string) {
  if (pathname.startsWith("/guest/league/")) return "/guest/league/[leagueId]";
  if (pathname.startsWith("/dashboard/league/")) return "/dashboard/league/[leagueId]";
  if (pathname.startsWith("/players/")) return "/players/[playerId]";
  return pathname;
}

export function shouldRecordAnalyticsEvent(
  storage: Pick<Storage, "getItem" | "setItem">,
  pathname: string,
  now = Date.now(),
  minimumIntervalMs = 5_000,
) {
  const previous = storage.getItem(ANALYTICS_LAST_EVENT_KEY);
  if (previous) {
    try {
      const parsed = JSON.parse(previous) as { path?: unknown; at?: unknown };
      if (parsed.path === pathname && typeof parsed.at === "number" && now - parsed.at < minimumIntervalMs) return false;
    } catch { /* Replace malformed state below. */ }
  }
  storage.setItem(ANALYTICS_LAST_EVENT_KEY, JSON.stringify({ path: pathname, at: now }));
  return true;
}
