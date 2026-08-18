import "server-only";
import { createClient } from "../supabase/server";
import { calculateLeagueSeasonPoints } from "../fantasy/league-scoring";
import type { PlayerSeasonRow } from "../players/types";
import { DEFAULT_VALUE_LEAGUE, EARLY_SEASON_PRIOR } from "./config";
import { calculatePlayerValues } from "./calculate";
import {
  scoreProjectionPool,
  type CurrentDepthRole,
  type ValueProjectionRecord,
} from "./projections";
import type { CombinedPlayerValue, ValueLeagueConfig } from "./types";
import { optionalQuery } from "./optional-query";

type DatabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function getLatestProjectionPool(
  db: DatabaseClient,
  signal?: AbortSignal,
): Promise<{
  records: ValueProjectionRecord[];
  season: number;
  week: number;
  modelVersionId: string;
} | null> {
  let latestQuery = db
    .from("player_projections")
    .select("season,week,model_version_id")
    .eq("season_type", "REG")
    .order("season", { ascending: false })
    .order("week", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(1);
  if (signal) latestQuery = latestQuery.abortSignal(signal);
  const { data: latest, error: latestError } = await latestQuery.maybeSingle();
  if (latestError)
    throw new Error(
      `Unable to resolve current projection week: ${latestError.message}`,
    );
  if (!latest) return null;
  const records: ValueProjectionRecord[] = [];
  for (let start = 0; ; start += 1000) {
    let recordsQuery = db
      .from("player_projections")
      .select(
        "player_id,season,week,projected_stats,model_projection_ppr,final_projection_ppr,projection_diagnostics,residual_low,residual_high,confidence,players(id,full_name,position,sleeper_position,historical_position,team,headshot_url,sleeper_player_id,birth_date,rookie_season,draft_year,draft_round,draft_pick,draft_status)",
      )
      .eq("season", latest.season)
      .eq("week", latest.week)
      .eq("season_type", "REG")
      .eq("model_version_id", latest.model_version_id)
      .range(start, start + 999);
    if (signal) recordsQuery = recordsQuery.abortSignal(signal);
    const { data, error } = await recordsQuery;
    if (error)
      throw new Error(`Unable to load projection pool: ${error.message}`);
    records.push(...((data ?? []) as unknown as ValueProjectionRecord[]));
    if ((data ?? []).length < 1000) break;
  }
  return {
    records,
    season: Number(latest.season),
    week: Number(latest.week),
    modelVersionId: latest.model_version_id,
  };
}

export function calculateValueContexts(
  projectionPool: ValueProjectionRecord[],
  week: number,
  leagueConfig?: ValueLeagueConfig,
  historyRows: PlayerSeasonRow[] = [],
  depthRoles: Map<string, CurrentDepthRole> = new Map(),
) {
  const projectionSeason = Number(projectionPool[0]?.season ?? 0);
  const priorsFor = (settings: Record<string, number>) => {
    const currentGames = new Map(
      historyRows
        .filter((row) => row.season === projectionSeason)
        .map((row) => [row.player_id, Number(row.games_played ?? 0)]),
    );
    const weights = EARLY_SEASON_PRIOR.recentSeasonWeights;
    const byPlayer = new Map<
      string,
      Array<{ ppg: number; games: number; weight: number }>
    >();
    for (const row of historyRows) {
      const seasonsAgo = projectionSeason - row.season;
      if (
        seasonsAgo < 1 ||
        seasonsAgo > weights.length ||
        !Number(row.games_played)
      )
        continue;
      const entries = byPlayer.get(row.player_id) ?? [];
      entries.push({
        ppg:
          calculateLeagueSeasonPoints(row, settings) / Number(row.games_played),
        games: Number(row.games_played),
        weight: weights[seasonsAgo - 1],
      });
      byPlayer.set(row.player_id, entries);
    }
    const playerIds = new Set([...byPlayer.keys(), ...currentGames.keys()]);
    return new Map(
      [...playerIds].map((playerId) => {
        const entries = byPlayer.get(playerId) ?? [];
        const weight = entries.reduce(
          (total, entry) => total + entry.weight,
          0,
        );
        return [
          playerId,
          {
            ppg:
              weight > 0
                ? entries.reduce(
                    (total, entry) => total + entry.ppg * entry.weight,
                    0,
                  ) / weight
                : 0,
            games: entries.reduce((total, entry) => total + entry.games, 0),
            currentSeasonGames: currentGames.get(playerId) ?? 0,
          },
        ];
      }),
    );
  };
  const generalPool = scoreProjectionPool(
    projectionPool,
    DEFAULT_VALUE_LEAGUE.scoringSettings,
    priorsFor(DEFAULT_VALUE_LEAGUE.scoringSettings),
    depthRoles,
  );
  const general = calculatePlayerValues(
    generalPool,
    DEFAULT_VALUE_LEAGUE,
    week,
  );
  const league = leagueConfig
    ? calculatePlayerValues(
        scoreProjectionPool(
          projectionPool,
          leagueConfig.scoringSettings,
          priorsFor(leagueConfig.scoringSettings),
          depthRoles,
        ),
        leagueConfig,
        week,
      )
    : null;
  const leagueByPlayerId = new Map(
    league?.values.map((value) => [value.playerId, value]) ?? [],
  );
  return {
    general,
    league,
    byPlayerId: new Map(
      general.values.map((value) => {
        const leagueValue = leagueByPlayerId.get(value.playerId) ?? null;
        return [
          value.playerId,
          {
            playerId: value.playerId,
            general: value,
            league: leagueValue,
          } satisfies CombinedPlayerValue,
        ];
      }),
    ),
  };
}

export async function getCurrentDepthRoles(
  db: DatabaseClient,
  playerIds: string[],
  season: number,
  context: { leagueId?: string } = {},
) {
  if (!playerIds.length) return new Map<string, CurrentDepthRole>();
  return optionalQuery({
    label: "Depth chart lookup failed",
    fallback: new Map<string, CurrentDepthRole>(),
    metadata: {
      source: "Supabase/player_depth_chart_roles",
      season,
      playerCount: playerIds.length,
      leagueId: context.leagueId,
    },
    query: async (signal) => {
      const roles = new Map<string, CurrentDepthRole>();
      for (let start = 0; start < playerIds.length; start += 500) {
        const { data, error } = await db
          .from("player_depth_chart_roles")
          .select(
            "player_id,position,depth_position,depth_rank,is_starter,team,source_updated_at",
          )
          .in("player_id", playerIds.slice(start, start + 500))
          .eq("season", season)
          .order("source_updated_at", { ascending: false })
          .abortSignal(signal);
        if (error)
          throw new Error("Unable to load depth chart roles: " + error.message);
        for (const row of data ?? []) {
          if (roles.has(row.player_id)) continue;
          roles.set(row.player_id, {
            playerId: row.player_id,
            position: row.position,
            depthPosition: row.depth_position,
            depthRank: Number(row.depth_rank),
            isStarter: Boolean(row.is_starter),
            team: row.team,
            sourceUpdatedAt: row.source_updated_at,
          });
        }
      }
      return roles;
    },
  });
}

export async function getProjectionHistoryRows(
  db: DatabaseClient,
  playerIds: string[],
  season: number,
): Promise<PlayerSeasonRow[]> {
  if (!playerIds.length) return [];
  return optionalQuery({
    label: "Projection history lookup failed",
    fallback: [] as PlayerSeasonRow[],
    metadata: {
      source: "Supabase/player_value_season_history",
      season,
      playerCount: playerIds.length,
    },
    query: async (signal) => {
      const rows: PlayerSeasonRow[] = [];
      for (let start = 0; start < playerIds.length; start += 500) {
        const { data, error } = await db
          .from("player_value_season_history")
          .select("*")
          .in("player_id", playerIds.slice(start, start + 500))
          .gte("season", season - 3)
          .lte("season", season)
          .eq("season_type", "REG")
          .abortSignal(signal);
        if (error)
          throw new Error(
            "Unable to load projection history: " + error.message,
          );
        rows.push(...((data ?? []) as PlayerSeasonRow[]));
      }
      return rows;
    },
  });
}

export async function getPlayerValue(
  playerId: string,
  leagueId?: string,
): Promise<CombinedPlayerValue | null> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  let leagueConfig: ValueLeagueConfig | undefined;
  if (leagueId) {
    const { data: league, error } = await db
      .from("leagues")
      .select("total_rosters,roster_positions,scoring_settings")
      .eq("id", leagueId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) throw new Error(`Unable to load value league: ${error.message}`);
    if (!league) throw new Error("Selected league is unavailable.");
    leagueConfig = {
      teams: Number(league.total_rosters ?? 10),
      rosterPositions: league.roster_positions ?? [],
      scoringSettings: league.scoring_settings ?? { rec: 1 },
    };
  }
  const latest = await getLatestProjectionPool(db);
  if (!latest) return null;
  const playerIds = latest.records.map((record) => record.player_id);
  const [history, depthRoles] = await Promise.all([
    getProjectionHistoryRows(db, playerIds, latest.season),
    getCurrentDepthRoles(db, playerIds, latest.season),
  ]);
  return (
    calculateValueContexts(
      latest.records,
      latest.week,
      leagueConfig,
      history,
      depthRoles,
    ).byPlayerId.get(playerId) ?? null
  );
}
