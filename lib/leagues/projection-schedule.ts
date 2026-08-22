import "server-only";
import { analyzeDstScoring } from "@/lib/fantasy/dst-scoring";
import { getInjuriesByPlayerIds } from "@/lib/injuries/service";
import { parsePlayerIdentifier } from "@/lib/players/identifiers";
import { optimizeProjectedLineup } from "@/lib/player-values/lineup";
import type { LeagueAnalyticsPlayer } from "@/lib/player-values/league-service";
import { ACTIVE_MODEL_RELATION_FILTER } from "@/lib/projections/active-model";
import { buildSeasonProjectionHorizon, currentProjectionWeek, type ProjectionScheduleGame } from "@/lib/projections/season-horizon";
import type { ProjectionRecord } from "@/lib/projections/types";
import type { createClient } from "@/lib/supabase/server";
import type { WeeklyTeamProjection } from "./head-to-head";

type DatabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface ProjectionScheduleTeam {
  id: string;
  players: LeagueAnalyticsPlayer[];
}

const SELECT = "player_id,season,week,season_type,team,opponent_team,projected_stats,model_projection_ppr,opportunity_adjusted_ppr,vegas_projection_ppr,sleeper_projection_ppr,final_projection_ppr,blend_weight_model,vegas_confidence,opportunity_confidence,sanity_adjustment,outlier_classification,projection_diagnostics,projected_points_standard,projected_points_half_ppr,projected_points_ppr,residual_low,residual_high,confidence,drivers,generated_at,model_versions!inner(version,is_active)";

export async function projectLeagueSchedule(input: {
  db: DatabaseClient;
  season: number;
  teams: ProjectionScheduleTeam[];
  rosterPositions: string[];
  scoringSettings: Record<string, number>;
}) {
  const playerById = new Map(input.teams.flatMap((team) => team.players.map((player) => [player.id, player] as const)));
  // Ephemeral Sleeper rosters can contain provider-only K/DST identifiers such
  // as `sleeper:CLE`. They remain visible on the roster, but must never be sent
  // into UUID-only projection and injury queries.
  const playerIds = [...playerById.keys()].filter(
    (playerId) => parsePlayerIdentifier(playerId)?.kind === "uuid",
  );
  const [{ data: games, error: gamesError }, injuries] = await Promise.all([
    input.db.from("nfl_games").select("week,kickoff,home_team,away_team")
      .eq("season", input.season).eq("season_type", "REG").order("week"),
    getInjuriesByPlayerIds(input.db, playerIds),
  ]);
  if (gamesError) throw new Error(`Unable to load NFL schedule for league matchups: ${gamesError.message}`);
  const projectionRows: ProjectionRecord[] = [];
  for (let start = 0; start < playerIds.length; start += 40) {
    const { data, error } = await input.db.from("player_projections").select(SELECT)
      .in("player_id", playerIds.slice(start, start + 40))
      .eq("season", input.season).eq("season_type", "REG")
      .eq(ACTIVE_MODEL_RELATION_FILTER, true)
      .order("week", { ascending: true }).order("generated_at", { ascending: false });
    if (error) throw new Error(`Unable to load league projection horizon: ${error.message}`);
    projectionRows.push(...((data ?? []) as unknown as ProjectionRecord[]));
  }
  const latestByPlayerWeek = new Map<string, ProjectionRecord>();
  for (const row of projectionRows) {
    const key = `${row.player_id}:${row.week}`;
    if (!latestByPlayerWeek.has(key)) latestByPlayerWeek.set(key, row);
  }
  const recordsByPlayer = new Map<string, ProjectionRecord[]>();
  for (const row of latestByPlayerWeek.values()) recordsByPlayer.set(row.player_id, [...(recordsByPlayer.get(row.player_id) ?? []), row]);
  const scheduleGames = (games ?? []) as ProjectionScheduleGame[];
  const weeklyPoints = new Map<string, number>();
  for (const [playerId, records] of recordsByPlayer) {
    const identity = playerById.get(playerId);
    if (!identity) continue;
    const series = buildSeasonProjectionHorizon({
      records,
      games: scheduleGames,
      injury: injuries.get(playerId),
      context: { mode: "league", settings: input.scoringSettings, position: identity.position },
    }).rows;
    for (const row of series) weeklyPoints.set(`${row.projection.week}:${playerId}`, row.projection.projectedPoints);
  }
  const projections: WeeklyTeamProjection[] = [];
  for (let week = 1; week <= 17; week += 1) {
    for (const team of input.teams) {
      const playerProjectedPpg = Object.fromEntries(team.players.map((player) => [
        player.id,
        weeklyPoints.get(`${week}:${player.id}`) ?? 0,
      ]));
      projections.push({
        teamId: team.id,
        week,
        playerProjectedPpg,
        lineup: optimizeProjectedLineup(team.players.map((player) => ({
          playerId: player.id,
          position: player.position,
          projectedPpg: weeklyPoints.get(`${week}:${player.id}`) ?? null,
        })), input.rosterPositions),
      });
    }
  }
  return {
    projections,
    currentWeek: currentProjectionWeek(scheduleGames),
    dstCoverage: analyzeDstScoring(input.scoringSettings),
  };
}
