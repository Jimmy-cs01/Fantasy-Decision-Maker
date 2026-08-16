import "server-only";
import { createClient } from "@/lib/supabase/server";
import { scoringSortColumn } from "./filters";
import type { LeaderSort, PlayerSeasonRow, PositionFilter, ScoringFormat, SeasonType } from "./types";

export async function getAvailableSeasons(seasonType: SeasonType = "REG") {
  const db = await createClient();
  const { data, error } = await db.from("available_player_seasons").select("season").eq("season_type", seasonType).order("season", { ascending: false });
  if (error) throw new Error(`Unable to load seasons: ${error.message}`);
  return (data ?? []).map((row) => Number(row.season));
}

export async function getPlayerLeaders(options: { season: number; seasonType: SeasonType; position: PositionFilter; scoring: ScoringFormat; sort: LeaderSort; page: number; view: "leaders" | "all" }) {
  const db = await createClient(); const pageSize = 50; const start = (options.page - 1) * pageSize;
  const sortColumn = scoringSortColumn(options.sort, options.scoring);
  let query = db.from("player_season_stats").select("*", { count: "exact" }).eq("season", options.season).eq("season_type", options.seasonType);
  if (options.position === "FLEX") query = query.in("historical_position", ["RB", "WR", "TE"]);
  else if (options.position !== "ALL") query = query.eq("historical_position", options.position);
  query = options.view === "all" ? query.order("full_name", { ascending: true }) : query.order(sortColumn as string, { ascending: false }).order("full_name", { ascending: true });
  const { data, count, error } = await query.range(start, start + pageSize - 1);
  if (error) throw new Error(`Unable to load player leaders: ${error.message}`);
  return { rows: (data ?? []) as PlayerSeasonRow[], total: count ?? 0, pageSize };
}

export async function getPlayerDetail(playerId: string, requestedSeason?: number, seasonType: SeasonType = "REG") {
  const db = await createClient();
  const { data: player, error: playerError } = await db.from("players").select("id,full_name,gsis_id,pfr_player_id,sleeper_player_id,historical_position,sleeper_position,sleeper_fantasy_positions,team,birth_date,college,rookie_season,height,weight").eq("id", playerId).maybeSingle();
  if (playerError) throw new Error(`Unable to load player: ${playerError.message}`);
  if (!player) return null;
  const { data: seasonRows, error: seasonError } = await db.from("player_season_stats").select("season").eq("player_id", playerId).eq("season_type", seasonType).order("season", { ascending: false });
  if (seasonError) throw new Error(`Unable to load player seasons: ${seasonError.message}`);
  const seasons = (seasonRows ?? []).map((row) => Number(row.season));
  const season = requestedSeason && seasons.includes(requestedSeason) ? requestedSeason : seasons[0];
  if (!season) return { player, seasons, season: null, summary: null, weeks: [] };
  const [{ data: summary, error: summaryError }, { data: weeks, error: weeksError }] = await Promise.all([
    db.from("player_season_stats").select("*").eq("player_id", playerId).eq("season", season).eq("season_type", seasonType).maybeSingle(),
    db.from("player_weekly_nfl_statistics").select("week,game_id,team,targets,receptions,receiving_yards,rush_attempts,rushing_yards,passing_yards,total_touchdowns,offense_snaps,fantasy_points_standard,fantasy_points_half_ppr,fantasy_points_ppr").eq("player_id", playerId).eq("season", season).eq("season_type", seasonType).order("week", { ascending: true }),
  ]);
  if (summaryError) throw new Error(`Unable to load season summary: ${summaryError.message}`);
  if (weeksError) throw new Error(`Unable to load weekly stats: ${weeksError.message}`);
  return { player, seasons, season, summary: summary as PlayerSeasonRow | null, weeks: weeks ?? [] };
}
