import "server-only";
import type { InjuryRecord } from "./types";

type DatabaseClient = { from: (table: string) => any };

export async function getInjuriesByPlayerIds(db: DatabaseClient, playerIds: string[]) {
  const rows: InjuryRecord[] = [];
  for (let start = 0; start < playerIds.length; start += 100) {
    const { data, error } = await db.from("player_injuries").select("*").in("player_id", playerIds.slice(start, start + 100));
    if (error) throw new Error(`Unable to load injury availability: ${error.message}`);
    rows.push(...((data ?? []) as InjuryRecord[]));
  }
  return new Map(rows.map((row) => [row.player_id, row]));
}
