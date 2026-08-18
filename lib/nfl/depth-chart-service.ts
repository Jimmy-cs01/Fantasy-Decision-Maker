import "server-only";
import type { createClient } from "../supabase/server";
import { calculateValueContexts, getLatestProjectionPool, getProjectionHistoryRows } from "../player-values/service";
import { optionalQuery } from "../player-values/optional-query";
import type { CurrentDepthRole } from "../player-values/projections";

type DatabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface DepthChartPlayer {
  id: string;
  name: string;
  team: string;
  position: string;
  depthPosition: string;
  depthRank: number;
  isStarter: boolean;
  headshotUrl: string | null;
  projectedPpg: number | null;
  playerValue: number | null;
}

interface RoleRow {
  player_id: string;
  team: string;
  position: string;
  depth_position: string;
  depth_rank: number;
  is_starter: boolean;
  source_updated_at: string;
  players: { id: string; full_name: string; headshot_url: string | null } | Array<{ id: string; full_name: string; headshot_url: string | null }> | null;
}

export async function getDepthChartsForTeams(db: DatabaseClient, teams: string[], season: number) {
  if (!teams.length) return new Map<string, DepthChartPlayer[]>();
  const data = await optionalQuery({
    label: "Depth-chart display lookup failed",
    fallback: [] as RoleRow[],
    metadata: { source: "Supabase/player_depth_chart_roles", season, teams: teams.join(",") },
    query: async (signal) => {
      const result = await db.from("player_depth_chart_roles")
        .select("player_id,team,position,depth_position,depth_rank,is_starter,source_updated_at,players(id,full_name,headshot_url)")
        .eq("season", season).in("team", [...new Set(teams)])
        .order("source_updated_at", { ascending: false })
        .abortSignal(signal);
      if (result.error) throw new Error(result.error.message);
      return (result.data ?? []) as unknown as RoleRow[];
    },
  });
  const latestRows: RoleRow[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (seen.has(row.player_id)) continue;
    seen.add(row.player_id);
    latestRows.push(row);
  }
  if (!latestRows.length) return new Map<string, DepthChartPlayer[]>();
  const playerIds = latestRows.map((row) => row.player_id);
  const depthRoles = new Map<string, CurrentDepthRole>(latestRows.map((row) => [row.player_id, {
    playerId: row.player_id, position: row.position, depthPosition: row.depth_position,
    depthRank: Number(row.depth_rank), isStarter: Boolean(row.is_starter), team: row.team,
    sourceUpdatedAt: row.source_updated_at,
  }]));
  const latest = await optionalQuery({
    label: "Depth-chart projection lookup failed", fallback: null,
    metadata: { source: "Supabase/player_projections", season, playerCount: playerIds.length },
    query: (signal) => getLatestProjectionPool(db, signal),
  });
  const history = latest ? await optionalQuery({
    label: "Depth-chart history lookup failed",
    fallback: [],
    metadata: { source: "Supabase/player_value_season_history", season: latest.season, playerCount: playerIds.length },
    query: async () => getProjectionHistoryRows(db, playerIds, latest.season),
  }) : [];
  let values = new Map();
  if (latest) {
    try { values = calculateValueContexts(latest.records, latest.week, undefined, history, depthRoles).byPlayerId; }
    catch (calculationError) { console.warn("Depth-chart values unavailable; rendering roles only.", calculationError); }
  }
  const byTeam = new Map<string, DepthChartPlayer[]>();
  for (const row of latestRows) {
    const player = Array.isArray(row.players) ? row.players[0] : row.players;
    if (!player) continue;
    const value = values.get(row.player_id)?.general;
    byTeam.set(row.team, [...(byTeam.get(row.team) ?? []), {
      id: player.id, name: player.full_name, team: row.team, position: row.position,
      depthPosition: row.depth_position, depthRank: Number(row.depth_rank),
      isStarter: Boolean(row.is_starter), headshotUrl: player.headshot_url,
      projectedPpg: value?.projectedPpg ?? null, playerValue: value?.value ?? null,
    }]);
  }
  for (const [team, players] of byTeam) {
    byTeam.set(team, players.sort((left, right) =>
      left.position.localeCompare(right.position) || left.depthPosition.localeCompare(right.depthPosition)
      || left.depthRank - right.depthRank || left.name.localeCompare(right.name)));
  }
  return byTeam;
}
