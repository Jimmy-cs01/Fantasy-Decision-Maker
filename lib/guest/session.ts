export const GUEST_SESSION_KEY = "jimmy-gm:guest-session:v1";

export interface GuestLeagueSummary {
  leagueId: string;
  name: string;
  season: string;
  totalRosters: number | null;
}

export interface GuestSession {
  mode: "guest";
  sleeperUserId: string;
  sleeperUsername: string;
  selectedLeagueId: string | null;
  leagues: GuestLeagueSummary[];
}

export function parseGuestSession(value: string | null): GuestSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<GuestSession>;
    if (
      parsed.mode !== "guest" ||
      typeof parsed.sleeperUserId !== "string" ||
      typeof parsed.sleeperUsername !== "string" ||
      !Array.isArray(parsed.leagues)
    ) return null;
    return {
      mode: "guest",
      sleeperUserId: parsed.sleeperUserId,
      sleeperUsername: parsed.sleeperUsername,
      selectedLeagueId:
        typeof parsed.selectedLeagueId === "string"
          ? parsed.selectedLeagueId
          : null,
      leagues: parsed.leagues.flatMap((league): GuestLeagueSummary[] => {
        if (!league || typeof league !== "object") return [];
        const candidate = league as Partial<GuestLeagueSummary>;
        if (
          typeof candidate.leagueId !== "string" ||
          typeof candidate.name !== "string" ||
          typeof candidate.season !== "string"
        ) return [];
        return [{
          leagueId: candidate.leagueId,
          name: candidate.name,
          season: candidate.season,
          totalRosters:
            typeof candidate.totalRosters === "number"
              ? candidate.totalRosters
              : null,
        }];
      }),
    };
  } catch {
    return null;
  }
}

export function readGuestSession(storage: Pick<Storage, "getItem"> = sessionStorage) {
  return parseGuestSession(storage.getItem(GUEST_SESSION_KEY));
}

export function writeGuestSession(
  session: GuestSession,
  storage: Pick<Storage, "setItem"> = sessionStorage,
) {
  storage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
  if (typeof window !== "undefined" && storage === window.sessionStorage)
    window.dispatchEvent(new Event("jimmy-gm:guest-session"));
}

export function clearGuestSession(
  storage: Pick<Storage, "removeItem"> = sessionStorage,
) {
  storage.removeItem(GUEST_SESSION_KEY);
  if (typeof window !== "undefined" && storage === window.sessionStorage)
    window.dispatchEvent(new Event("jimmy-gm:guest-session"));
}

export function guestLeagueHref(leagueId: string, view = "overview") {
  const suffix = view === "overview" ? "" : `?view=${encodeURIComponent(view)}`;
  return `/guest/league/${encodeURIComponent(leagueId)}${suffix}`;
}
