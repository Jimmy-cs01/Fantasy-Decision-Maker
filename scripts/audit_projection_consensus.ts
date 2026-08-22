import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase URL and service role are required.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const season = Number(process.argv[process.argv.indexOf("--season") + 1] || 2026);
const week = Number(process.argv[process.argv.indexOf("--week") + 1] || 1);
const version = process.argv[process.argv.indexOf("--version") + 1] || "v4.1";

const { data: model, error: modelError } = await db.from("model_versions").select("id,version,is_active").eq("version", version).single();
if (modelError || !model) throw new Error(`Model ${version} is unavailable: ${modelError?.message ?? "missing"}`);
const { data, error } = await db.from("player_projections")
  .select("player_id,model_projection_ppr,sleeper_projection_ppr,final_projection_ppr,projection_diagnostics,players(full_name,position,sleeper_position,historical_position)")
  .eq("model_version_id", model.id).eq("season", season).eq("week", week).eq("season_type", "REG");
if (error) throw new Error(`Projection audit failed: ${error.message}`);

const rows = (data ?? []).map((row) => {
  const player = Array.isArray(row.players) ? row.players[0] : row.players;
  const diagnostics = (row.projection_diagnostics ?? {}) as Record<string, unknown>;
  const base = Number(row.model_projection_ppr ?? 0);
  const sleeper = row.sleeper_projection_ppr == null ? null : Number(row.sleeper_projection_ppr);
  const final = Number(row.final_projection_ppr ?? base);
  const preSleeper = diagnostics.preSleeperPpr == null ? null : Number(diagnostics.preSleeperPpr);
  const component = diagnostics.componentConsensusPpr == null ? null : Number(diagnostics.componentConsensusPpr);
  const role = diagnostics.roleAdjustedPpr == null ? null : Number(diagnostics.roleAdjustedPpr);
  const consensusMagnitude = component == null || role == null
    ? Math.abs(final - base)
    : Math.abs(component - role) + Math.abs(final - Number(preSleeper ?? final));
  return {
    player: player?.full_name ?? row.player_id,
    position: player?.sleeper_position ?? player?.position ?? player?.historical_position,
    base, sleeper, final,
    difference: sleeper == null ? null : sleeper - base,
    sleeper_weight: Number(diagnostics.sleeperWeight ?? 0),
    final_minus_base: final - base,
    consensus_magnitude: consensusMagnitude,
    outside_model_consensus_range: sleeper != null && (final > Math.max(base, sleeper) + .011 || final < Math.min(base, sleeper) - .011),
  };
});
const thresholds = Object.fromEntries([.25, .5, 1, 2].map((threshold) => [threshold, rows.filter((row) => row.consensus_magnitude > threshold).length]));
const report = {
  generated_at: new Date().toISOString(), season, week, version,
  active_model: model.is_active, projection_rows: rows.length,
  players_with_consensus: rows.filter((row) => row.sleeper != null).length,
  material_adjustments: thresholds,
  final_above_both: rows.filter((row) => row.sleeper != null && row.final > Math.max(row.base, row.sleeper) + .011).length,
  final_below_both: rows.filter((row) => row.sleeper != null && row.final < Math.min(row.base, row.sleeper) - .011).length,
  rows: rows.sort((left, right) => right.consensus_magnitude - left.consensus_magnitude),
};
writeFileSync("data/processed/projection_consensus_audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
