import type { createClient } from "@/lib/supabase/server";

type DatabaseClient = Awaited<ReturnType<typeof createClient>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLEEPER_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export type PlayerIdentifier =
  | { kind: "uuid"; value: string }
  | { kind: "sleeper"; value: string };

export function decodePlayerIdentifier(input: string) {
  try {
    return decodeURIComponent(input).trim();
  } catch {
    return input.trim();
  }
}

export function parsePlayerIdentifier(input: string): PlayerIdentifier | null {
  const decoded = decodePlayerIdentifier(input);
  if (UUID_PATTERN.test(decoded)) return { kind: "uuid", value: decoded };
  const sleeperId = decoded.startsWith("sleeper:") ? decoded.slice("sleeper:".length) : decoded;
  if (!sleeperId || !SLEEPER_ID_PATTERN.test(sleeperId)) return null;
  return { kind: "sleeper", value: sleeperId };
}

/** Resolve every external reference once, then use the canonical UUID downstream. */
export async function resolveCanonicalPlayerId(
  db: DatabaseClient,
  input: string,
): Promise<string | null> {
  const identifier = parsePlayerIdentifier(input);
  if (!identifier) return null;
  const column = identifier.kind === "uuid" ? "id" : "sleeper_player_id";
  const { data, error } = await db
    .from("players")
    .select("id")
    .eq(column, identifier.value)
    .maybeSingle();
  if (error) throw error;
  if (!data && identifier.kind === "sleeper" && process.env.NODE_ENV === "development") {
    console.warn("Sleeper player is not mapped to a canonical Jimmy GM player", {
      sleeperPlayerId: identifier.value,
    });
  }
  return data?.id ?? null;
}
