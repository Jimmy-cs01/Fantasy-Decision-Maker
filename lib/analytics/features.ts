const FEATURES: Array<[prefix: string, label: string]> = [
  ["/dashboard/connect", "League connections"],
  ["/dashboard/league", "League dashboard"],
  ["/dashboard", "Dashboard"],
  ["/players", "Players"],
  ["/matchups", "Matchups"],
  ["/start-sit", "Start / Sit"],
  ["/season", "Season Outlook"],
  ["/depth-charts", "Depth Charts"],
  ["/trades", "Trade Finder"],
  ["/admin", "Administration"],
];

export function featureForPath(path: string) {
  return FEATURES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? "Other";
}

export function normalizedAuthenticatedPath(path: string) {
  if (path.startsWith("/dashboard/league/")) return "/dashboard/league/[leagueId]";
  if (path.startsWith("/players/")) return "/players/[playerId]";
  return path;
}
