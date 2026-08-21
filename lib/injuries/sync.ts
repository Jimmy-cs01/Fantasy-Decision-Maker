import { sleeperClient } from "../sleeper/client";
import type { SleeperPlayer } from "../sleeper/types";
import { injuryFingerprint, normalizeSleeperInjury } from "./normalize";
import type { InjuryRecord } from "./types";

type DatabaseClient = { from: (table: string) => any };
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K"]);

export async function syncSleeperInjuries(
  db: DatabaseClient,
  suppliedPlayers?: Record<string, SleeperPlayer>,
) {
  const fetchedAt = new Date().toISOString();
  const remote = suppliedPlayers ?? await sleeperClient.getPlayers();
  const canonical: Array<{ id: string; sleeper_player_id: string; position: string | null }> = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await db.from("players").select("id,sleeper_player_id,position,sleeper_position,historical_position")
      .not("sleeper_player_id", "is", null).range(start, start + 999);
    if (error) throw new Error(`Unable to map Sleeper injury identities: ${error.message}`);
    for (const row of data ?? []) {
      const position = String(row.sleeper_position ?? row.position ?? row.historical_position ?? "").toUpperCase();
      if (row.sleeper_player_id && FANTASY_POSITIONS.has(position)) canonical.push({ id: row.id, sleeper_player_id: row.sleeper_player_id, position });
    }
    if ((data ?? []).length < 1000) break;
  }
  const records = canonical.flatMap((player): InjuryRecord[] => {
    const source = remote[player.sleeper_player_id];
    return source ? [normalizeSleeperInjury(player.id, source, fetchedAt)] : [];
  });
  const existing = new Map<string, InjuryRecord>();
  // UUID filters are encoded into PostgREST URLs. Keep these comfortably below
  // Undici/header limits; payload writes below use request bodies instead.
  for (let start = 0; start < records.length; start += 50) {
    const ids = records.slice(start, start + 50).map((row) => row.player_id);
    const { data, error } = await db.from("player_injuries").select("*").in("player_id", ids);
    if (error) throw new Error(`Unable to inspect current injury statuses: ${error.message}`);
    for (const row of data ?? []) existing.set(row.player_id, row as InjuryRecord);
  }
  const changed = records.filter((row) => injuryFingerprint(row) !== injuryFingerprint(existing.get(row.player_id) ?? { ...row, status: "unknown", source: "missing", fetched_at: "" }));
  for (let start = 0; start < records.length; start += 500) {
    const batch = records.slice(start, start + 500).map((row) => ({ ...row, updated_at: fetchedAt }));
    const { error } = await db.from("player_injuries").upsert(batch, { onConflict: "player_id" });
    if (error) throw new Error(`Unable to store injury statuses: ${error.message}`);
  }
  for (let start = 0; start < changed.length; start += 500) {
    const batch = changed.slice(start, start + 500).map((row) => ({
      player_id: row.player_id, team: row.team, status: row.status,
      raw_status: row.raw_status, roster_status: row.roster_status,
      practice_participation: row.practice_participation,
      injury_body_part: row.injury_body_part,
      expected_return_date: row.expected_return_date,
      expected_games_missed: row.expected_games_missed,
      timeline_type: row.timeline_type,
      source: row.source, observed_at: fetchedAt, snapshot: row,
    }));
    const { error } = await db.from("player_injury_history").insert(batch);
    if (error) throw new Error(`Unable to store injury history: ${error.message}`);
  }
  return { fetchedAt, remotePlayers: Object.keys(remote).length, canonicalPlayers: canonical.length, matchedPlayers: records.length, changedPlayers: changed.length };
}
