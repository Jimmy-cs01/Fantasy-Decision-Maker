import "server-only";

import { DEFAULT_VALUE_LEAGUE } from "../player-values/config";
import { calculateValueContexts, getCurrentDepthRoles, getLatestProjectionPool, getProjectionHistoryRows } from "../player-values/service";
import { projectionIdentity } from "../player-values/projections";
import { displayedProjectionPoints } from "../projections/presentation";
import type { TradePlayer } from "./engine";

type DatabaseClient = Parameters<typeof getLatestProjectionPool>[0];

export async function getStandaloneTradePlayerPool(db: DatabaseClient): Promise<TradePlayer[]> {
  const latest = await getLatestProjectionPool(db);
  if (!latest) return [];
  const ids = latest.records.map((record) => record.player_id);
  const [history, depthRoles] = await Promise.all([
    getProjectionHistoryRows(db, ids, latest.season),
    getCurrentDepthRoles(db, ids, latest.season),
  ]);
  const contexts = calculateValueContexts(latest.records, latest.week, undefined, history, depthRoles);
  return latest.records.flatMap((record): TradePlayer[] => {
    const identity = projectionIdentity(record);
    const value = contexts.byPlayerId.get(record.player_id)?.general;
    const position = (identity?.sleeper_position ?? identity?.position ?? identity?.historical_position)?.toUpperCase() ?? null;
    if (!identity || !value || !position || !["QB", "RB", "WR", "TE", "K"].includes(position)) return [];
    const depth = depthRoles.get(record.player_id);
    return [{
      id: record.player_id,
      teamId: "",
      name: identity.full_name,
      position,
      nflTeam: identity.team,
      headshotUrl: identity.headshot_url,
      value: value.value,
      projectedPpg: displayedProjectionPoints({ stats: record.projected_stats, position, mode: "ppr" }),
      depthRole: depth ? `${depth.depthPosition}${depth.depthRank}` : null,
    }];
  }).sort((left, right) => Number(right.value) - Number(left.value) || left.name.localeCompare(right.name));
}

export const STANDALONE_ROSTER_POSITIONS = DEFAULT_VALUE_LEAGUE.rosterPositions;
