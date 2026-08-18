import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { arbitrateProjection, type VegasGameEvidence, type VegasPropEvidence } from "../lib/projections/arbitration";
import {
  buildProjectionApplyRow,
  describeInvalidProjectionApplyRow,
  validateProjectionApplyRows,
} from "../lib/projections/apply-payload";
import {
  countRequiredInputFailures,
  RECONCILIATION_QUERY_BATCH_SIZE,
  RECONCILIATION_QUERY_TIMEOUT_MS,
  runBatchedRemoteQuery,
  runRemoteQuery,
} from "../lib/projections/remote-query";
import { calculateProjectedFantasyPoints } from "../lib/projections/scoring";
import { normalizeNflTeam } from "../lib/nfl/teams";
import type { ProjectedStatLine, ProjectionConfidence } from "../lib/projections/types";

loadEnvConfig(process.cwd());

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const season = Number(argument("--season"));
const week = Number(argument("--week"));
const version = argument("--version") ?? "v2";
const apply = process.argv.includes("--apply");
if (!Number.isInteger(season) || !Number.isInteger(week)) {
  throw new Error("Usage: npm run projections:reconcile -- --season 2026 --week 1 --version v2 [--apply]");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const modelVersionResult = await runRemoteQuery({
  label: "Model version",
  query: (signal) => db.from("model_versions").select("id").eq("version", version).limit(1).abortSignal(signal),
});
const modelVersion = modelVersionResult.data[0];
if (modelVersionResult.error || !modelVersion) {
  throw new Error(`Model version ${version} is unavailable after bounded retries.`);
}

const projectionResult = await runRemoteQuery({
  label: "Canonical projections and players",
  query: (signal) => db.from("player_projections")
    .select("id,player_id,model_version_id,season,week,season_type,team,opponent_team,projected_stats,raw_projected_stats,model_projection_ppr,sleeper_projection_ppr,residual_low,residual_high,confidence,drivers,players(gsis_id,full_name,position,historical_position,sleeper_position,team,status)")
    .eq("season", season).eq("week", week).eq("season_type", "REG")
    .eq("model_version_id", modelVersion.id).abortSignal(signal),
});
if (projectionResult.error) throw new Error("Unable to load canonical projections after bounded retries.");
const projections = projectionResult.data;

const playerIds = projections.map((row) => row.player_id);
const roleResult = await runBatchedRemoteQuery({
  label: "Depth roles",
  values: playerIds,
  query: (batch, signal) => db.from("player_depth_chart_roles")
    .select("player_id,depth_position,depth_rank,is_starter,source_updated_at")
    .in("player_id", batch).eq("season", season)
    .order("source_updated_at", { ascending: false }).abortSignal(signal),
});
const roleByPlayer = new Map<string, { depthRank: number; depthPosition: string; isStarter: boolean }>();
for (const role of roleResult.data) {
  if (!roleByPlayer.has(role.player_id)) roleByPlayer.set(role.player_id, {
    depthRank: Number(role.depth_rank), depthPosition: role.depth_position, isStarter: Boolean(role.is_starter),
  });
}

const historyByPlayer = new Map<string, { games: number; opportunityShare: number }>();
const historyResult = await runBatchedRemoteQuery({
  label: "Recent usage",
  values: playerIds,
  query: (batch, signal) => db.from("player_value_season_history")
    .select("player_id,games_played,pass_attempts,rush_attempts,receptions")
    .in("player_id", batch).eq("season", season - 1).eq("season_type", "REG")
    .abortSignal(signal),
});
for (const row of historyResult.data) {
  const games = Number(row.games_played ?? 0); if (!games) continue;
  const weeklyOpportunity = (Number(row.pass_attempts ?? 0) + Number(row.rush_attempts ?? 0) + Number(row.receptions ?? 0)) / games;
  historyByPlayer.set(row.player_id, { games, opportunityShare: Math.min(1, weeklyOpportunity / 28) });
}

const gameResult = await runRemoteQuery({
  label: "NFL schedule",
  query: (signal) => db.from("nfl_games")
    .select("id,home_team,away_team,kickoff").eq("season", season).eq("week", week)
    .eq("season_type", "REG").abortSignal(signal),
});
const games = gameResult.data;
const consensusResult = await runRemoteQuery({
  label: "Vegas game consensus",
  query: (signal) => db.from("odds_games_consensus")
    .select("nfl_game_id,consensus_home_spread,consensus_total,consensus_home_moneyline,consensus_away_moneyline,consensus_home_implied_total,consensus_away_implied_total,books_reporting,latest_update")
    .eq("season", season).eq("week", week).abortSignal(signal),
});
const consensusByGame = new Map(consensusResult.data.map((row) => [row.nfl_game_id, row]));
const gameByTeam = new Map<string, VegasGameEvidence>();
for (const game of games) {
  const line = consensusByGame.get(game.id);
  if (!line) continue;
  gameByTeam.set(game.home_team, {
    teamImpliedTotal: line.consensus_home_implied_total == null ? null : Number(line.consensus_home_implied_total),
    opponentImpliedTotal: line.consensus_away_implied_total == null ? null : Number(line.consensus_away_implied_total),
    spread: line.consensus_home_spread == null ? null : Number(line.consensus_home_spread),
    gameTotal: line.consensus_total == null ? null : Number(line.consensus_total),
    moneyline: line.consensus_home_moneyline == null ? null : Number(line.consensus_home_moneyline),
    booksReporting: Number(line.books_reporting), capturedAt: line.latest_update, kickoff: game.kickoff, isHome: true,
  });
  gameByTeam.set(game.away_team, {
    teamImpliedTotal: line.consensus_away_implied_total == null ? null : Number(line.consensus_away_implied_total),
    opponentImpliedTotal: line.consensus_home_implied_total == null ? null : Number(line.consensus_home_implied_total),
    spread: line.consensus_home_spread == null ? null : -Number(line.consensus_home_spread),
    gameTotal: line.consensus_total == null ? null : Number(line.consensus_total),
    moneyline: line.consensus_away_moneyline == null ? null : Number(line.consensus_away_moneyline),
    booksReporting: Number(line.books_reporting), capturedAt: line.latest_update, kickoff: game.kickoff, isHome: false,
  });
}

const gameIds = games.map((game) => game.id);
const propsResult = await runBatchedRemoteQuery({
  label: "Player props",
  values: playerIds,
  query: (batch, signal) => db.from("player_props_consensus")
    .select("player_id,market,consensus_line,consensus_over_odds,line_stddev,books_reporting,latest_update,nfl_game_id")
    .in("player_id", batch).in("nfl_game_id", gameIds).abortSignal(signal),
});
const propsByPlayer = new Map<string, VegasPropEvidence[]>();
for (const prop of propsResult.data) {
  if (prop.consensus_line == null) continue;
  propsByPlayer.set(prop.player_id, [...(propsByPlayer.get(prop.player_id) ?? []), {
    market: prop.market,
    line: Number(prop.consensus_line),
    overOdds: prop.consensus_over_odds == null ? null : Number(prop.consensus_over_odds),
    booksReporting: Number(prop.books_reporting),
    lineStddev: prop.line_stddev == null ? null : Number(prop.line_stddev),
    capturedAt: prop.latest_update,
  }]);
}

const reconciled = projections.flatMap((record) => {
  const player = Array.isArray(record.players) ? record.players[0] : record.players;
  if (!player) return [];
  const position = (player.sleeper_position ?? player.position ?? player.historical_position)?.toUpperCase();
  if (!position) return [];
  const rawStats = (record.raw_projected_stats ?? record.projected_stats) as ProjectedStatLine;
  const canonicalTeam = normalizeNflTeam(player.team ?? record.team ?? "");
  const isInactive = ["inactive", "retired"].includes(String(player.status ?? "").toLowerCase());
  const history = historyByPlayer.get(record.player_id);
  const result = arbitrateProjection({
    position,
    rawStats,
    modelPpr: Number(record.model_projection_ppr),
    currentTeam: isInactive ? null : canonicalTeam,
    depth: roleByPlayer.get(record.player_id),
    historicalGames: history?.games ?? 0,
    recentOpportunityShare: history?.opportunityShare ?? null,
    sleeperPpr: record.sleeper_projection_ppr == null ? null : Number(record.sleeper_projection_ppr),
    vegasProps: propsByPlayer.get(record.player_id),
    vegasGame: canonicalTeam ? gameByTeam.get(canonicalTeam) : null,
    modelConfidence: record.confidence as ProjectionConfidence,
  });
  const residualLow = Number(record.residual_low) * result.residualScale;
  const residualHigh = Number(record.residual_high) * result.residualScale;
  const standard = calculateProjectedFantasyPoints(result.stats, { rec: 0 }, position);
  const half = calculateProjectedFantasyPoints(result.stats, { rec: 0.5 }, position);
  const ppr = calculateProjectedFantasyPoints(result.stats, { rec: 1 }, position);
  return [{
    update: buildProjectionApplyRow(record, {
      raw_projected_stats: rawStats,
      projected_stats: result.stats,
      model_projection_ppr: record.model_projection_ppr,
      sleeper_projection_ppr: record.sleeper_projection_ppr,
      opportunity_adjusted_ppr: result.opportunityAdjustedPpr,
      vegas_projection_ppr: result.vegasPpr,
      final_projection_ppr: result.finalPpr,
      blend_weight_model: result.modelWeight,
      vegas_confidence: result.vegasConfidence,
      opportunity_confidence: result.opportunityConfidence,
      sanity_adjustment: result.finalPpr - Number(record.model_projection_ppr),
      outlier_classification: result.outlierStatus,
      projection_diagnostics: result.diagnostics,
      projected_points_standard: standard,
      projected_points_half_ppr: half,
      projected_points_ppr: ppr,
      floor_ppr: Math.max(0, ppr + residualLow),
      median_ppr: ppr,
      ceiling_ppr: Math.max(0, ppr + residualHigh),
      residual_low: residualLow,
      residual_high: residualHigh,
      confidence: result.confidence,
      drivers: [...new Set([...result.drivers, ...((record.drivers ?? []) as string[])])].slice(0, 4),
    }),
    report: {
      player_id: record.player_id,
      gsis_id: player.gsis_id,
      player: player.full_name,
      team: canonicalTeam,
      position,
      depth_role: roleByPlayer.has(record.player_id)
        ? `${roleByPlayer.get(record.player_id)?.depthPosition}${roleByPlayer.get(record.player_id)?.depthRank}`
        : null,
      recent_games: history?.games ?? 0,
      recent_opportunity_share: history?.opportunityShare ?? null,
      raw_model_ppr: Number(record.model_projection_ppr),
      opportunity_adjusted_ppr: result.opportunityAdjustedPpr,
      vegas_ppr: result.vegasPpr,
      final_ppr: result.finalPpr,
      component_ppr: ppr,
      projected_stats: result.stats,
      outlier: result.outlierStatus,
    },
  }];
});
const updates = reconciled.map((row) => row.update);
const applyPreflight = validateProjectionApplyRows(updates, projections.length, {
  modelVersionId: modelVersion.id,
  season,
  week,
  seasonType: "REG",
});

const canonicalPlayersMatched = projections.filter((record) => {
  const player = Array.isArray(record.players) ? record.players[0] : record.players;
  return Boolean(player);
}).length;
const canonicalTeamsMatched = projections.filter((record) => {
  const player = Array.isArray(record.players) ? record.players[0] : record.players;
  return Boolean(normalizeNflTeam(player?.team ?? record.team ?? ""));
}).length;
const projectionTeams = new Set(projections.flatMap((record) => {
  const player = Array.isArray(record.players) ? record.players[0] : record.players;
  const team = normalizeNflTeam(player?.team ?? record.team ?? "");
  return team ? [team] : [];
}));
const vegasTeamsMatched = [...projectionTeams].filter((team) => gameByTeam.has(team)).length;
const componentPprMismatches = reconciled.filter(
  (row) => Math.abs(row.report.final_ppr - row.report.component_ppr) > 1e-6,
).length;
const requiredFailures = countRequiredInputFailures({
  canonicalPlayersComplete: canonicalPlayersMatched === projections.length,
  updatesComplete: updates.length === projections.length && applyPreflight.safe,
  depthQueryFailures: roleResult.queryFailures,
  historyQueryFailures: historyResult.queryFailures,
  scheduleQueryFailed: Boolean(gameResult.error),
  scheduleIsEmpty: games.length === 0,
  vegasGamesQueryFailed: Boolean(consensusResult.error),
  propsQueryFailures: propsResult.queryFailures,
}) + componentPprMismatches;
const safeToApply = requiredFailures === 0;

const counts = new Map<string, number>();
for (const row of updates) counts.set(row.outlier_classification, (counts.get(row.outlier_classification) ?? 0) + 1);
console.log(`Reconciled ${updates.length} ${season} Week ${week} projections for ${version}.`);
console.log(`Outliers: normal=${counts.get("normal") ?? 0} watch=${counts.get("watch") ?? 0} large=${counts.get("large") ?? 0} extreme=${counts.get("extreme") ?? 0}`);
console.log("Projection reconciliation input health");
console.log(`Query policy: ${RECONCILIATION_QUERY_BATCH_SIZE} IDs/request; ${RECONCILIATION_QUERY_TIMEOUT_MS / 1_000}s timeout; retries at 250ms and 750ms`);
console.log(`Players: ${projections.length}`);
console.log(`Canonical players: matched=${canonicalPlayersMatched} missing=${projections.length - canonicalPlayersMatched} query failures=${projectionResult.error ? 1 : 0}`);
console.log(`Canonical teams: matched=${canonicalTeamsMatched} missing=${projections.length - canonicalTeamsMatched} query failures=0`);
console.log(`Depth roles: matched=${roleByPlayer.size} legitimately missing=${Math.max(0, projections.length - roleByPlayer.size)} query failures=${roleResult.queryFailures}`);
console.log(`Recent usage: matched=${historyByPlayer.size} no recent NFL usage=${Math.max(0, projections.length - historyByPlayer.size)} query failures=${historyResult.queryFailures}`);
console.log(`Vegas games: matched=${vegasTeamsMatched} teams missing=${Math.max(0, projectionTeams.size - vegasTeamsMatched)} query failures=${Number(Boolean(gameResult.error || consensusResult.error))}`);
console.log(`Player props: players with props=${propsByPlayer.size} players without props=${Math.max(0, projections.length - propsByPlayer.size)} query failures=${propsResult.queryFailures}`);
console.log(`Component/PPR mismatches: ${componentPprMismatches}`);
console.log("Player props data is optional when the query succeeds; a failed props query blocks apply because absence cannot be verified.");
console.log(`Required enrichment failures: ${requiredFailures}`);
console.log(`Safe to apply: ${safeToApply ? "YES" : "NO"}`);
console.log("Projection apply payload preflight");
console.log(`Target: season=${season} week=${week} season_type=REG model_version=${version} (${modelVersion.id})`);
console.log(`Conflict key: player_projections.id`);
console.log(`Reconciled rows: ${applyPreflight.reconciledRows}`);
console.log(`Valid apply rows: ${applyPreflight.validRows}`);
console.log(`Invalid apply rows: ${applyPreflight.invalidRows.length}`);
console.log(`Duplicate projection IDs: ${applyPreflight.duplicateIds.length}`);
for (const invalid of applyPreflight.invalidRows.slice(0, 5)) {
  console.error(`Invalid projection apply payload: ${describeInvalidProjectionApplyRow(invalid)}`);
}

mkdirSync("data/processed", { recursive: true });
writeFileSync("data/processed/projection_reconciliation_report.json", JSON.stringify({
  generated_at: new Date().toISOString(),
  season,
  week,
  version,
  safe_to_apply: safeToApply,
  required_failures: requiredFailures,
  apply_preflight: {
    reconciled_rows: applyPreflight.reconciledRows,
    valid_rows: applyPreflight.validRows,
    invalid_rows: applyPreflight.invalidRows.length,
    duplicate_projection_ids: applyPreflight.duplicateIds,
    conflict_key: "id",
    target_model_version_id: modelVersion.id,
  },
  batch_size: RECONCILIATION_QUERY_BATCH_SIZE,
  timeout_ms: RECONCILIATION_QUERY_TIMEOUT_MS,
  outliers: Object.fromEntries(counts),
  completeness: {
    players: projections.length,
    canonical_players: { matched: canonicalPlayersMatched, missing: projections.length - canonicalPlayersMatched },
    canonical_teams: { matched: canonicalTeamsMatched, missing: projections.length - canonicalTeamsMatched },
    depth_roles: { matched: roleByPlayer.size, missing: Math.max(0, projections.length - roleByPlayer.size), query_failures: roleResult.queryFailures },
    recent_usage: { matched: historyByPlayer.size, missing: Math.max(0, projections.length - historyByPlayer.size), query_failures: historyResult.queryFailures },
    vegas_games: { matched_teams: vegasTeamsMatched, missing_teams: Math.max(0, projectionTeams.size - vegasTeamsMatched), query_failures: Number(Boolean(gameResult.error || consensusResult.error)) },
    player_props: { matched_players: propsByPlayer.size, missing_players: Math.max(0, projections.length - propsByPlayer.size), query_failures: propsResult.queryFailures },
    component_ppr_mismatches: componentPprMismatches,
  },
  rows: reconciled.map((row) => row.report),
}, null, 2));
console.log("Report: data/processed/projection_reconciliation_report.json");
if (!apply) {
  console.log(safeToApply
    ? "Dry run: no remote writes performed. Inputs are complete; review the audit before passing --apply."
    : "Dry run: no remote writes performed. Required inputs are incomplete; --apply will be refused.");
  process.exit(0);
}
if (!safeToApply) {
  const payloadProblem = applyPreflight.invalidRows[0];
  if (payloadProblem) {
    throw new Error(`Refusing to apply: ${applyPreflight.invalidRows.length} projection row${applyPreflight.invalidRows.length === 1 ? " is" : "s are"} invalid. ${describeInvalidProjectionApplyRow(payloadProblem)}`);
  }
  throw new Error("Refusing to apply projections because required enrichment failed or the payload count/identity check failed.");
}
const { error: applyError } = await db.from("player_projections").upsert(updates, { onConflict: "id" });
if (applyError) throw new Error(`Projection reconciliation failed before commit: ${applyError.message}`);
console.log(`Projection reconciliation atomically upserted ${updates.length} rows.`);
