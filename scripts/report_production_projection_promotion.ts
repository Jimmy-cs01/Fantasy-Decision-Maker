import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { DEFAULT_VALUE_LEAGUE } from "../lib/player-values/config";
import { calculatePlayerValues } from "../lib/player-values/calculate";
import {
  historicalValueContexts,
  projectionIdentity,
  projectionPriors,
  scoreProjectionPool,
  type CurrentDepthRole,
  type ValueProjectionRecord,
} from "../lib/player-values/projections";
import type { PlayerSeasonRow } from "../lib/players/types";
import { resolveActiveProjectionModelVersion } from "../lib/projections/active-model";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase production credentials are required.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const projectionSelect = "player_id,season,week,projected_stats,model_projection_ppr,final_projection_ppr,projection_diagnostics,residual_low,residual_high,confidence,players(id,full_name,position,sleeper_position,historical_position,team,headshot_url,sleeper_player_id,birth_date,rookie_season,draft_year,draft_round,draft_pick,draft_status),model_versions!inner(version)";

async function pool(version: string) {
  const { data, error } = await db.from("player_projections").select(projectionSelect)
    .eq("season", 2026).eq("week", 1).eq("season_type", "REG")
    .eq("model_versions.version", version).range(0, 999);
  if (error) throw new Error(`${version} projection query failed: ${error.message}`);
  return (data ?? []) as unknown as ValueProjectionRecord[];
}

const [v2, v33] = await Promise.all([pool("v2"), pool("v3.3")]);
const history: PlayerSeasonRow[] = [];
for (let start = 0; ; start += 1000) {
  const { data, error } = await db.from("player_value_season_history").select("*")
    .in("historical_position", ["QB", "RB", "WR", "TE"])
    .gte("season", 2022).lte("season", 2026).eq("season_type", "REG")
    .range(start, start + 999);
  if (error) throw new Error(`History query failed: ${error.message}`);
  history.push(...((data ?? []) as PlayerSeasonRow[]));
  if ((data ?? []).length < 1000) break;
}
const { data: depthData, error: depthError } = await db.from("player_depth_chart_roles")
  .select("player_id,position,depth_position,depth_rank,is_starter,team,source_updated_at")
  .eq("season", 2026).order("source_updated_at", { ascending: false }).range(0, 999);
if (depthError) throw new Error(`Depth query failed: ${depthError.message}`);
const depth = new Map<string, CurrentDepthRole>();
for (const row of depthData ?? []) if (!depth.has(row.player_id)) depth.set(row.player_id, {
  playerId: row.player_id, position: row.position, depthPosition: row.depth_position,
  depthRank: Number(row.depth_rank), isStarter: Boolean(row.is_starter), team: row.team,
  sourceUpdatedAt: row.source_updated_at,
});

function values(records: ValueProjectionRecord[]) {
  const priors = projectionPriors(history, DEFAULT_VALUE_LEAGUE.scoringSettings, 2026);
  const scored = scoreProjectionPool(
    records, DEFAULT_VALUE_LEAGUE.scoringSettings, priors, depth,
    historicalValueContexts(history, DEFAULT_VALUE_LEAGUE.scoringSettings, 2026),
  );
  return calculatePlayerValues(scored, DEFAULT_VALUE_LEAGUE, 1).values;
}

const v2Values = new Map(values(v2).map((row) => [row.playerId, row]));
const v33Values = new Map(values(v33).map((row) => [row.playerId, row]));
const v2ByPlayer = new Map(v2.map((row) => [row.player_id, row]));
const comparisons = v33.map((row) => {
  const player = projectionIdentity(row);
  const old = v2ByPlayer.get(row.player_id);
  return {
    player_id: row.player_id,
    player: player?.full_name ?? row.player_id,
    position: player?.sleeper_position ?? player?.position ?? player?.historical_position,
    depth_role: depth.has(row.player_id) ? `${depth.get(row.player_id)?.depthPosition}${depth.get(row.player_id)?.depthRank}` : null,
    v2_final_ppg: old?.final_projection_ppr == null ? null : Number(old.final_projection_ppr),
    v3_3_raw_ppg: Number(row.model_projection_ppr),
    v3_3_final_ppg: row.final_projection_ppr == null ? null : Number(row.final_projection_ppr),
    difference: old?.final_projection_ppr == null || row.final_projection_ppr == null
      ? null : Number(row.final_projection_ppr) - Number(old.final_projection_ppr),
    v2_value: v2Values.get(row.player_id)?.value ?? null,
    v3_3_value: v33Values.get(row.player_id)?.value ?? null,
  };
}).sort((left, right) => (right.difference ?? -Infinity) - (left.difference ?? -Infinity));

const names = new Set([
  "Christian McCaffrey", "Jahmyr Gibbs", "Justin Jefferson", "Ja'Marr Chase",
  "Trey McBride", "Brock Bowers", "Colston Loveland", "Frank Gore Jr.",
  "Jarquez Hunter", "Josh Allen",
]);
const report = {
  generated_at: new Date().toISOString(),
  configured_active_model: resolveActiveProjectionModelVersion(),
  v2_rows: v2.length,
  v3_3_rows: v33.length,
  named: comparisons.filter((row) => names.has(row.player)),
  top_increases: comparisons.slice(0, 25),
  top_decreases: [...comparisons].sort((left, right) => (left.difference ?? Infinity) - (right.difference ?? Infinity)).slice(0, 25),
};
writeFileSync("data/processed/production_v3_3_promotion_report.json", JSON.stringify(report, null, 2));
console.log(`Configured active model: ${report.configured_active_model}`);
console.log(`Remote rows: v2=${v2.length}; v3.3=${v33.length}`);
console.table(report.named);
console.log("Report: data/processed/production_v3_3_promotion_report.json");
