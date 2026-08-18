export function normalizePlayerName(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.’'\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function uniquePlayerNameMatches<T extends { id: string; name: string }>(players: T[]) {
  const grouped = new Map<string, T[]>();
  for (const player of players) {
    const key = normalizePlayerName(player.name);
    grouped.set(key, [...(grouped.get(key) ?? []), player]);
  }
  return new Map(
    [...grouped.entries()].map(([key, matches]) => [
      key,
      matches.length === 1 ? matches[0] : null,
    ]),
  );
}
