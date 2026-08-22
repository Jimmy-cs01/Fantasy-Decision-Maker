import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalizeProjection } from "./normalize";
import { ACTIVE_MODEL_RELATION_FILTER } from "./active-model";
import type { ProjectionRecord, ProjectionScoringMode } from "./types";
import { getInjuriesByPlayerIds } from "../injuries/service";
import { calculateAvailability } from "../injuries/availability";
import { expectedGamesRemaining } from "../player-values/formula";
import { getWeeklyMatchups, matchupContextByTeam } from "../nfl/schedule-service";
import { buildSeasonProjectionHorizon } from "./season-horizon";

const projectionSelect = "player_id,season,week,season_type,team,opponent_team,projected_stats,model_projection_ppr,opportunity_adjusted_ppr,vegas_projection_ppr,sleeper_projection_ppr,final_projection_ppr,blend_weight_model,vegas_confidence,opportunity_confidence,sanity_adjustment,outlier_classification,projection_diagnostics,projected_points_standard,projected_points_half_ppr,projected_points_ppr,residual_low,residual_high,confidence,drivers,generated_at,model_versions!inner(version,is_active)";

export async function getPlayerProjection(
  playerId: string,
  options: { season?: number; week?: number; leagueId?: string; scoring?: ProjectionScoringMode } = {},
) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();

  let settings: Record<string, number> | undefined;
  if (options.leagueId) {
    if (!user) throw new Error("Sign in to use saved league scoring on player profiles.");
    const { data: league, error } = await db.from("leagues")
      .select("scoring_settings")
      .eq("id", options.leagueId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) throw new Error(`Unable to load league scoring: ${error.message}`);
    if (!league) throw new Error("Selected league is unavailable.");
    settings = league.scoring_settings as Record<string, number>;
  }

  let query = db.from("player_projections")
    .select(projectionSelect)
    .eq("player_id", playerId)
    .eq("season_type", "REG")
    .eq(ACTIVE_MODEL_RELATION_FILTER, true);
  if (options.season) query = query.eq("season", options.season);
  if (options.week) query = query.eq("week", options.week);
  const { data, error } = await query
    .order("season", { ascending: false })
    .order("week", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Unable to load player projection: ${error.message}`);
  if (!data) return null;

  const [{ data: player, error: playerError }, injuryRows] = await Promise.all([db.from("players")
    .select("historical_position,sleeper_position")
    .eq("id", playerId)
    .maybeSingle(), getInjuriesByPlayerIds(db, [playerId])]);
  if (playerError) throw new Error(`Unable to load projection player: ${playerError.message}`);
  const mode = options.scoring ?? (settings ? "league" : "ppr");
  const matchup = data.team ? matchupContextByTeam(await getWeeklyMatchups(db, data.season, data.week)).get(data.team) : null;
  const availability = calculateAvailability(injuryRows.get(playerId), expectedGamesRemaining(Number(data.week)), new Date(), matchup?.kickoff);
  return normalizeProjection(data as unknown as ProjectionRecord, {
    mode: mode === "league" && !settings ? "ppr" : mode,
    settings,
    position: player?.sleeper_position ?? player?.historical_position,
    availability,
  });
}

export interface WeeklyProjectionView {
  projection: ReturnType<typeof normalizeProjection>;
  isHome: boolean | null;
  kickoff: string | null;
  isBye: boolean;
  isForecast: boolean;
  isCurrent: boolean;
}

export async function getPlayerProjectionSeries(
  playerId: string,
  options: { season: number; leagueId?: string; scoring?: ProjectionScoringMode },
): Promise<WeeklyProjectionView[]> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  let settings: Record<string, number> | undefined;
  if (options.leagueId) {
    if (!user) return [];
    const { data: league, error } = await db.from("leagues")
      .select("scoring_settings").eq("id", options.leagueId).eq("owner_id", user.id).maybeSingle();
    if (error) throw new Error(`Unable to load league scoring: ${error.message}`);
    settings = league?.scoring_settings as Record<string, number> | undefined;
  }
  const [{ data: player, error: playerError }, { data: rows, error: rowsError }, { data: games, error: gamesError }, injuries] = await Promise.all([
    db.from("players").select("historical_position,sleeper_position").eq("id", playerId).maybeSingle(),
    db.from("player_projections").select(projectionSelect).eq("player_id", playerId)
      .eq("season", options.season).eq("season_type", "REG")
      .eq(ACTIVE_MODEL_RELATION_FILTER, true)
      .order("week", { ascending: true }).order("generated_at", { ascending: false }),
    db.from("nfl_games").select("week,kickoff,home_team,away_team").eq("season", options.season)
      .eq("season_type", "REG").order("week", { ascending: true }),
    getInjuriesByPlayerIds(db, [playerId]),
  ]);
  if (playerError) throw new Error(`Unable to load projection player: ${playerError.message}`);
  if (rowsError) throw new Error(`Unable to load weekly projections: ${rowsError.message}`);
  if (gamesError) throw new Error(`Unable to load projection schedule: ${gamesError.message}`);
  const mode = options.scoring ?? (settings ? "league" : "ppr");
  const latestByWeek = new Map<number, ProjectionRecord>();
  for (const row of rows ?? []) {
    const record = row as unknown as ProjectionRecord;
    if (!latestByWeek.has(Number(record.week))) latestByWeek.set(Number(record.week), record);
  }
  return buildSeasonProjectionHorizon({
    records: [...latestByWeek.values()],
    games: games ?? [],
    injury: injuries.get(playerId),
    context: {
      mode: mode === "league" && !settings ? "ppr" : mode,
      settings,
      position: player?.sleeper_position ?? player?.historical_position,
    },
  }).rows;
}
