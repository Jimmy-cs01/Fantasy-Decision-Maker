import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalizeProjection } from "./normalize";
import type { ProjectionRecord, ProjectionScoringMode } from "./types";

const projectionSelect = "player_id,season,week,season_type,team,opponent_team,projected_stats,model_projection_ppr,opportunity_adjusted_ppr,vegas_projection_ppr,sleeper_projection_ppr,final_projection_ppr,blend_weight_model,vegas_confidence,opportunity_confidence,sanity_adjustment,outlier_classification,projection_diagnostics,projected_points_standard,projected_points_half_ppr,projected_points_ppr,residual_low,residual_high,confidence,drivers,generated_at,model_versions(version)";

export async function getPlayerProjection(
  playerId: string,
  options: { season?: number; week?: number; leagueId?: string; scoring?: ProjectionScoringMode } = {},
) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;

  let settings: Record<string, number> | undefined;
  if (options.leagueId) {
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
    .eq("season_type", "REG");
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

  const { data: player, error: playerError } = await db.from("players")
    .select("historical_position,sleeper_position")
    .eq("id", playerId)
    .maybeSingle();
  if (playerError) throw new Error(`Unable to load projection player: ${playerError.message}`);
  const mode = options.scoring ?? (settings ? "league" : "ppr");
  return normalizeProjection(data as unknown as ProjectionRecord, {
    mode: mode === "league" && !settings ? "ppr" : mode,
    settings,
    position: player?.sleeper_position ?? player?.historical_position,
  });
}

export interface WeeklyProjectionView {
  projection: ReturnType<typeof normalizeProjection>;
  isHome: boolean | null;
  kickoff: string | null;
}

export async function getPlayerProjectionSeries(
  playerId: string,
  options: { season: number; leagueId?: string; scoring?: ProjectionScoringMode },
): Promise<WeeklyProjectionView[]> {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return [];
  let settings: Record<string, number> | undefined;
  if (options.leagueId) {
    const { data: league, error } = await db.from("leagues")
      .select("scoring_settings").eq("id", options.leagueId).eq("owner_id", user.id).maybeSingle();
    if (error) throw new Error(`Unable to load league scoring: ${error.message}`);
    settings = league?.scoring_settings as Record<string, number> | undefined;
  }
  const [{ data: player, error: playerError }, { data: rows, error: rowsError }, { data: games, error: gamesError }] = await Promise.all([
    db.from("players").select("historical_position,sleeper_position").eq("id", playerId).maybeSingle(),
    db.from("player_projections").select(projectionSelect).eq("player_id", playerId)
      .eq("season", options.season).eq("season_type", "REG")
      .order("week", { ascending: true }).order("generated_at", { ascending: false }),
    db.from("nfl_games").select("week,kickoff,home_team,away_team").eq("season", options.season)
      .eq("season_type", "REG").order("week", { ascending: true }),
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
  const gameByWeek = new Map((games ?? []).map((game) => [Number(game.week), game]));
  return [...latestByWeek.values()].sort((left, right) => left.week - right.week).map((record) => {
    const game = gameByWeek.get(Number(record.week));
    const isHome = game && record.team ? game.home_team === record.team : null;
    return {
      projection: normalizeProjection(record, {
        mode: mode === "league" && !settings ? "ppr" : mode,
        settings,
        position: player?.sleeper_position ?? player?.historical_position,
      }),
      isHome,
      kickoff: game?.kickoff ?? null,
    };
  });
}
