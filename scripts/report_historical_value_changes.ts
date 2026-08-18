import { createClient } from "@supabase/supabase-js";
import { calculatePlayerValues } from "../lib/player-values/calculate";
import { DEFAULT_VALUE_LEAGUE } from "../lib/player-values/config";
import {
  historicalValueContexts,
  projectionPriors,
  scoreProjectionPool,
  type CurrentDepthRole,
  type ValueProjectionRecord,
} from "../lib/player-values/projections";
import type { PlayerSeasonRow } from "../lib/players/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: latest, error: latestError } = await db.from("player_projections")
  .select("season,week,model_version_id").eq("season_type", "REG")
  .order("season", { ascending: false }).order("week", { ascending: false })
  .order("generated_at", { ascending: false }).limit(1).single();
if (latestError) throw latestError;
const { data: recordsData, error: recordsError } = await db.from("player_projections").select(
  "player_id,season,week,projected_stats,model_projection_ppr,final_projection_ppr,projection_diagnostics,residual_low,residual_high,confidence,players(id,full_name,position,sleeper_position,historical_position,team,headshot_url,sleeper_player_id,birth_date,rookie_season,draft_year,draft_round,draft_pick,draft_status)",
).eq("season", latest.season).eq("week", latest.week).eq("season_type", "REG").eq("model_version_id", latest.model_version_id);
if (recordsError) throw recordsError;
const records = recordsData as unknown as ValueProjectionRecord[];
const ids = records.map((record) => record.player_id);
const history: PlayerSeasonRow[] = [];
const depth = new Map<string, CurrentDepthRole>();
for (let start = 0; ; start += 1000) {
  const { data, error } = await db.from("player_value_season_history").select("*")
    .in("historical_position", ["QB", "RB", "WR", "TE"])
    .gte("season", Number(latest.season) - 4).lte("season", latest.season).eq("season_type", "REG")
    .order("season", { ascending: false }).order("player_id", { ascending: true })
    .range(start, start + 999);
  if (error) throw error;
  history.push(...(data as unknown as PlayerSeasonRow[]));
  if ((data ?? []).length < 1000) break;
}
for (let start = 0; start < ids.length; start += 100) {
  const batch = ids.slice(start, start + 100);
  const { data: depthRows, error: depthError } = await db.from("player_depth_chart_roles").select("player_id,position,depth_position,depth_rank,is_starter,team,source_updated_at")
      .in("player_id", batch).eq("season", latest.season).order("source_updated_at", { ascending: false });
  if (depthError) throw depthError;
  for (const row of depthRows ?? []) if (!depth.has(row.player_id)) depth.set(row.player_id, {
    playerId: row.player_id, position: row.position, depthPosition: row.depth_position,
    depthRank: Number(row.depth_rank), isStarter: Boolean(row.is_starter), team: row.team,
    sourceUpdatedAt: row.source_updated_at,
  });
}
const settings = DEFAULT_VALUE_LEAGUE.scoringSettings;
const priors = projectionPriors(history, settings, Number(latest.season));
const withoutHistory = calculatePlayerValues(scoreProjectionPool(records, settings, priors, depth), DEFAULT_VALUE_LEAGUE, Number(latest.week));
const withHistory = calculatePlayerValues(scoreProjectionPool(records, settings, priors, depth,
  historicalValueContexts(history, settings, Number(latest.season))), DEFAULT_VALUE_LEAGUE, Number(latest.week));
const oldById = new Map(withoutHistory.values.map((value) => [value.playerId, value]));
const comparison = withHistory.values.map((value) => ({
  player: value.fullName, position: value.position, before: oldById.get(value.playerId)?.value ?? value.value,
  after: value.value, change: Math.round((value.value - (oldById.get(value.playerId)?.value ?? value.value)) * 10) / 10,
  historical: value.historicalUpsideAdjustment, peak: value.historicalBestPositionRank ? `${value.position}${value.historicalBestPositionRank}` : "—",
})).sort((left, right) => right.change - left.change || right.after - left.after);
console.log(`Historical Player Value report · ${latest.season} Week ${latest.week}`);
console.table(comparison.filter((row) => row.change > 0).slice(0, 20));
console.log("Sanity players");
console.table(comparison.filter((row) => ["Justin Jefferson", "Ja'Marr Chase", "Travis Kelce", "Christian McCaffrey", "Davante Adams"].includes(row.player)));
