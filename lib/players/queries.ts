import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withLeagueScoring, type SleeperScoringSettings } from "@/lib/fantasy/league-scoring";
import { FANTASY_POSITIONS, scoringSortColumn } from "./filters";
import type { LeaderSort, PlayerSeasonRow, PositionFilter, ScoringFormat, ScoringLeague, SeasonType } from "./types";
import type { ProjectedPlayerLeaderRow, ProjectionLeaderSort } from "./types";
import { calculateValueContexts, getCurrentDepthRoles, getLatestProjectionPool, getProjectionHistoryRows } from "@/lib/player-values/service";
import { projectionIdentity } from "@/lib/player-values/projections";
import type { ValueLeagueConfig } from "@/lib/player-values/types";
import { calculateHistoricalPositionFinishes } from "./position-finishes";

async function attachHeadshots(db: Awaited<ReturnType<typeof createClient>>, rows: PlayerSeasonRow[]) {
  if (!rows.length) return rows;
  const ids = rows.map((row) => row.player_id);
  const { data, error } = await db.from("players").select("id,headshot_url").in("id", ids);
  if (error) throw new Error(`Unable to load player headshots: ${error.message}`);
  const headshots = new Map((data ?? []).map((player) => [player.id, player.headshot_url as string | null]));
  return rows.map((row) => ({ ...row, headshot_url: headshots.get(row.player_id) ?? null }));
}

export async function getScoringLeagues(): Promise<ScoringLeague[]> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return [];
  const { data, error } = await db.from("leagues")
    .select("id,name,season,scoring_settings,total_rosters,roster_positions")
    .eq("owner_id", user.id)
    .not("last_synced_at", "is", null)
    .order("last_synced_at", { ascending: false });
  if (error) throw new Error(`Unable to load league scoring settings: ${error.message}`);
  return (data ?? []).filter((league) => Object.keys(league.scoring_settings ?? {}).length > 0) as ScoringLeague[];
}

export async function getProjectedPlayerLeaders(options: {
  position: PositionFilter;
  scoring: ScoringFormat;
  scoringSettings?: SleeperScoringSettings;
  leagueConfig?: ValueLeagueConfig;
  sort: ProjectionLeaderSort;
  page: number;
}) {
  const db = await createClient();
  const latest = await getLatestProjectionPool(db);
  const pageSize = 50;
  if (!latest) return { rows: [] as ProjectedPlayerLeaderRow[], total: 0, pageSize, season: null };
  const playerIds = latest.records.map((record) => record.player_id);
  const [history, depthRoles] = await Promise.all([
    getProjectionHistoryRows(db, playerIds, latest.season),
    getCurrentDepthRoles(db, playerIds, latest.season),
  ]);
  const contexts = calculateValueContexts(latest.records, latest.week, options.leagueConfig, history, depthRoles);
  const records = new Map(latest.records.map((record) => [record.player_id, record]));
  let rows = [...contexts.byPlayerId.values()].flatMap((context): ProjectedPlayerLeaderRow[] => {
    const value = context.league ?? context.general;
    const record = records.get(value.playerId);
    const identity = record ? projectionIdentity(record) : null;
    if (!identity) return [];
    return [{
      player_id: value.playerId,
      full_name: value.fullName,
      position: value.position,
      team: identity.team,
      headshot_url: identity.headshot_url,
      projected_ppg: value.projectedPpg,
      projected_fpts: Math.round(value.projectedPpg * value.expectedGamesRemaining * 10) / 10,
      player_value: value.value,
      overall_rank: value.overallRank,
      position_rank: value.positionRank,
      depth_role: value.depthRole,
      projected_stats: record?.projected_stats ?? {},
    }];
  });
  rows = rows.filter((row) => options.position === "ALL"
    ? FANTASY_POSITIONS.includes(row.position as typeof FANTASY_POSITIONS[number])
    : options.position === "FLEX" ? ["RB", "WR", "TE"].includes(row.position) : row.position === options.position);
  const key: Record<ProjectionLeaderSort, keyof ProjectedPlayerLeaderRow> = {
    player_value: "player_value", value_rank: "overall_rank", projected_ppg: "projected_ppg", projected_fpts: "projected_fpts",
  };
  rows.sort((left, right) => options.sort === "value_rank"
    ? left.overall_rank - right.overall_rank
    : Number(right[key[options.sort]]) - Number(left[key[options.sort]]) || left.full_name.localeCompare(right.full_name));
  const total = rows.length;
  const start = (options.page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, pageSize, season: latest.season };
}

export async function getAvailableSeasons(seasonType: SeasonType = "REG") {
  const db = await createClient();
  const { data, error } = await db.from("available_player_seasons").select("season").eq("season_type", seasonType).order("season", { ascending: false });
  if (error) throw new Error(`Unable to load seasons: ${error.message}`);
  return (data ?? []).map((row) => Number(row.season));
}

export async function getPlayerLeaders(options: { season: number; seasonType: SeasonType; position: PositionFilter; scoring: ScoringFormat; scoringSettings?: SleeperScoringSettings; sort: LeaderSort; page: number; view: "leaders" | "all" }) {
  const db = await createClient(); const pageSize = 50; const start = (options.page - 1) * pageSize;
  const sortColumn = scoringSortColumn(options.sort, options.scoring);
  const baseQuery = (count = false) => {
    let query = db.from("player_season_stats").select("*", count ? { count: "exact" } : {}).eq("season", options.season).eq("season_type", options.seasonType);
    if (options.position === "ALL") query = query.in("historical_position", [...FANTASY_POSITIONS]);
    else if (options.position === "FLEX") query = query.in("historical_position", ["RB", "WR", "TE"]);
    else query = query.eq("historical_position", options.position);
    return query;
  };
  const customFantasySort = options.scoring === "league" && options.scoringSettings && options.view === "leaders" && (options.sort === "fantasy_points" || options.sort === "fantasy_ppg");
  if (customFantasySort) {
    const { data, count, error } = await baseQuery(true).range(0, 9999);
    if (error) throw new Error(`Unable to load player leaders: ${error.message}`);
    if ((count ?? 0) > (data?.length ?? 0)) throw new Error("League-scoring leaderboard exceeded the safe server calculation limit.");
    const scored = ((data ?? []) as PlayerSeasonRow[]).map((row) => withLeagueScoring(row, options.scoringSettings!));
    scored.sort((left, right) => Number(right[sortColumn] ?? Number.NEGATIVE_INFINITY) - Number(left[sortColumn] ?? Number.NEGATIVE_INFINITY) || left.full_name.localeCompare(right.full_name));
    const rows = await attachHeadshots(db, scored.slice(start, start + pageSize));
    return { rows, total: count ?? scored.length, pageSize };
  }
  let query = baseQuery(true);
  query = options.view === "all" ? query.order("full_name", { ascending: true }) : query.order(sortColumn as string, { ascending: false }).order("full_name", { ascending: true });
  const { data, count, error } = await query.range(start, start + pageSize - 1);
  if (error) throw new Error(`Unable to load player leaders: ${error.message}`);
  let rows = (data ?? []) as PlayerSeasonRow[];
  if (options.scoring === "league" && options.scoringSettings) rows = rows.map((row) => withLeagueScoring(row, options.scoringSettings!));
  rows = await attachHeadshots(db, rows);
  return { rows, total: count ?? 0, pageSize };
}

export async function getPlayerDetail(playerId: string, requestedSeason?: number, seasonType: SeasonType = "REG") {
  const db = await createClient();
  const { data: player, error: playerError } = await db.from("players").select("id,full_name,gsis_id,pfr_player_id,sleeper_player_id,historical_position,sleeper_position,sleeper_fantasy_positions,team,birth_date,college,rookie_season,height,weight,headshot_url").eq("id", playerId).maybeSingle();
  if (playerError) throw new Error(`Unable to load player: ${playerError.message}`);
  if (!player) return null;
  const { data: seasonRows, error: seasonError } = await db.from("player_season_stats").select("*").eq("player_id", playerId).eq("season_type", seasonType).order("season", { ascending: false });
  if (seasonError) throw new Error(`Unable to load player seasons: ${seasonError.message}`);
  const seasons = (seasonRows ?? []).map((row) => Number(row.season));
  const history = (seasonRows ?? []).slice(0, 4) as PlayerSeasonRow[];
  const season = requestedSeason && seasons.includes(requestedSeason) ? requestedSeason : seasons[0];
  if (!season) return { player, seasons, season: null, summary: null, weeks: [], history };
  const [{ data: summary, error: summaryError }, { data: weeks, error: weeksError }] = await Promise.all([
    db.from("player_season_stats").select("*").eq("player_id", playerId).eq("season", season).eq("season_type", seasonType).maybeSingle(),
    db.from("player_weekly_nfl_statistics").select("week,game_id,team,opponent_team,historical_position,pass_attempts,completions,completion_percentage,passing_yards,yards_per_attempt,passing_touchdowns,interceptions_thrown,first_down_passes,passing_epa,passing_cpoe,pacr,rush_attempts,rushing_yards,yards_per_carry,rushing_touchdowns,rushing_first_downs,rushing_epa,targets,receptions,receiving_yards,yards_per_target,yards_per_reception,receiving_touchdowns,receiving_first_downs,receiving_air_yards,yards_after_catch,receiving_adot,receiving_epa,racr,target_share,air_yards_share,wopr,true_touches,offense_snaps,team_offense_snaps,offense_snap_percentage,fantasy_points_standard,fantasy_points_half_ppr,fantasy_points_ppr").eq("player_id", playerId).eq("season", season).eq("season_type", seasonType).eq("provider", "nflverse").order("week", { ascending: true }),
  ]);
  if (summaryError) throw new Error(`Unable to load season summary: ${summaryError.message}`);
  if (weeksError) throw new Error(`Unable to load weekly stats: ${weeksError.message}`);
  return { player, seasons, season, summary: summary as PlayerSeasonRow | null, weeks: weeks ?? [], history };
}

export async function getHistoricalPositionFinishes(
  playerId: string,
  position: string | null,
  seasons: number[],
  scoringSettings: SleeperScoringSettings,
) {
  if (!position || !seasons.length) return new Map<number, number>();
  const db = await createClient();
  const { data, error } = await db.from("player_value_season_history").select("*")
    .eq("historical_position", position).in("season", seasons).eq("season_type", "REG");
  if (error) {
    console.warn("Historical position finishes unavailable", { position, seasons, message: error.message });
    return new Map<number, number>();
  }
  return calculateHistoricalPositionFinishes(data as unknown as PlayerSeasonRow[], playerId, scoringSettings);
}
