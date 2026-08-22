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
    .select("id,player_id,model_version_id,season,week,season_type,team,opponent_team,projected_stats,raw_projected_stats,model_projection_ppr,sleeper_projection_ppr,residual_low,residual_high,confidence,drivers,players(gsis_id,sleeper_player_id,full_name,position,historical_position,sleeper_position,team,status)")
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

const historyByPlayer = new Map<string, {
  games: number; seasons: number; opportunityShare: number; fantasyPpg: number;
  passAttempts: number;
  rushAttempts: number; rushingYards: number; rushingTouchdowns: number;
}>();
const historyResult = await runBatchedRemoteQuery({
  label: "Recent usage",
  values: playerIds,
  query: (batch, signal) => db.from("player_value_season_history")
    .select("player_id,season,games_played,fantasy_points_standard,pass_attempts,rush_attempts,rushing_yards,rushing_touchdowns,receptions")
    .in("player_id", batch).gte("season", season - 4).lt("season", season).eq("season_type", "REG")
    .abortSignal(signal),
});
const historyRowsByPlayer = new Map<string, typeof historyResult.data>();
for (const row of historyResult.data) {
  historyRowsByPlayer.set(row.player_id, [...(historyRowsByPlayer.get(row.player_id) ?? []), row]);
}
const seasonWeights = [1, 0.68, 0.42, 0.24];
for (const [playerId, rows] of historyRowsByPlayer) {
  let totalGames = 0;
  let totalWeight = 0;
  let opportunityShare = 0;
  let fantasyPpg = 0;
  let passAttempts = 0;
  let rushAttempts = 0;
  let rushingYards = 0;
  let rushingTouchdowns = 0;
  for (const row of rows) {
    const games = Number(row.games_played ?? 0);
    if (!games) continue;
    const seasonAge = Math.max(0, season - 1 - Number(row.season));
    const recency = seasonWeights[Math.min(seasonWeights.length - 1, seasonAge)];
    const sample = Math.min(1, games / 8);
    const weight = recency * sample;
    const weeklyPassAttempts = Number(row.pass_attempts ?? 0) / games;
    const weeklyRushAttempts = Number(row.rush_attempts ?? 0) / games;
    const weeklyReceptions = Number(row.receptions ?? 0) / games;
    totalGames += games;
    totalWeight += weight;
    opportunityShare += Math.min(1, (weeklyPassAttempts + weeklyRushAttempts + weeklyReceptions) / 28) * weight;
    fantasyPpg += ((Number(row.fantasy_points_standard ?? 0) + Number(row.receptions ?? 0)) / games) * weight;
    passAttempts += weeklyPassAttempts * weight;
    rushAttempts += weeklyRushAttempts * weight;
    rushingYards += (Number(row.rushing_yards ?? 0) / games) * weight;
    rushingTouchdowns += (Number(row.rushing_touchdowns ?? 0) / games) * weight;
  }
  if (!totalWeight) continue;
  historyByPlayer.set(playerId, {
    games: totalGames,
    seasons: rows.length,
    opportunityShare: opportunityShare / totalWeight,
    fantasyPpg: fantasyPpg / totalWeight,
    passAttempts: passAttempts / totalWeight,
    rushAttempts: rushAttempts / totalWeight,
    rushingYards: rushingYards / totalWeight,
    rushingTouchdowns: rushingTouchdowns / totalWeight,
  });
}

type SleeperProjectionRow = {
  player_id?: string;
  game_id?: string;
  updated_at?: number;
  last_modified?: number;
  stats?: Record<string, number | null>;
};
const sleeperById = new Map<string, {
  ppr: number;
  stats: NonNullable<Parameters<typeof arbitrateProjection>[0]["sleeperStats"]>;
  sourceUpdatedAt: string | null;
  externalGameId: string | null;
}>();
let sleeperQueryFailures = 0;
const reconciliationRetrievedAt = new Date().toISOString();
if (version.startsWith("v4")) {
  try {
    const response = await fetch(`https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular`, {
      headers: { "user-agent": "JimmyGM projection reconciliation" },
      signal: AbortSignal.timeout(RECONCILIATION_QUERY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Sleeper projections returned HTTP ${response.status}`);
    for (const row of await response.json() as SleeperProjectionRow[]) {
      if (!row.player_id || !row.stats) continue;
      const stats = row.stats;
      const normalized = {
        passAttempts: stats.pass_att, passingYards: stats.pass_yd, passingTouchdowns: stats.pass_td,
        rushAttempts: stats.rush_att, rushingYards: stats.rush_yd, rushingTouchdowns: stats.rush_td,
        targets: stats.rec_tgt, receptions: stats.rec, receivingYards: stats.rec_yd, receivingTouchdowns: stats.rec_td,
      };
      const ppr = Number(stats.pass_yd ?? 0) * 0.04 + Number(stats.pass_td ?? 0) * 4
        - Number(stats.pass_int ?? 0) * 2 + Number(stats.rush_yd ?? 0) * 0.1
        + Number(stats.rush_td ?? 0) * 6 + Number(stats.rec ?? 0)
        + Number(stats.rec_yd ?? 0) * 0.1 + Number(stats.rec_td ?? 0) * 6;
      const sourceTimestamp = row.updated_at ?? row.last_modified;
      sleeperById.set(String(row.player_id), {
        ppr,
        stats: normalized,
        sourceUpdatedAt: sourceTimestamp ? new Date(sourceTimestamp).toISOString() : null,
        externalGameId: row.game_id == null ? null : String(row.game_id),
      });
    }
  } catch (error) {
    sleeperQueryFailures = 1;
    console.warn(`Optional Sleeper consensus unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  const sleeper = player.sleeper_player_id ? sleeperById.get(String(player.sleeper_player_id)) : undefined;
  const result = arbitrateProjection({
    position,
    rawStats,
    modelPpr: Number(record.model_projection_ppr),
    currentTeam: isInactive ? null : canonicalTeam,
    depth: roleByPlayer.get(record.player_id),
    historicalGames: history?.games ?? 0,
    recentOpportunityShare: history?.opportunityShare ?? null,
    sleeperPpr: sleeper?.ppr ?? (record.sleeper_projection_ppr == null ? null : Number(record.sleeper_projection_ppr)),
    sleeperStats: sleeper?.stats,
    historicalBaseline: history ? {
      games: history.games, seasons: history.seasons, fantasyPpg: history.fantasyPpg,
      passAttempts: history.passAttempts, rushAttempts: history.rushAttempts,
      rushingYards: history.rushingYards, rushingTouchdowns: history.rushingTouchdowns,
    } : null,
    vegasProps: propsByPlayer.get(record.player_id),
    vegasGame: canonicalTeam ? gameByTeam.get(canonicalTeam) : null,
    modelConfidence: record.confidence as ProjectionConfidence,
    arbitrationVersion: version === "v4.1" ? "v4.1" : version.startsWith("v4") ? "v4" : "v3",
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
      sleeper_projection_ppr: sleeper?.ppr ?? record.sleeper_projection_ppr,
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
      diagnostics: result.diagnostics,
      sleeper: sleeper ?? null,
      vegas_props: propsByPlayer.get(record.player_id) ?? [],
      nfl_game_id: canonicalTeam ? games.find((game) => game.home_team === canonicalTeam || game.away_team === canonicalTeam)?.id ?? null : null,
      kickoff: canonicalTeam ? gameByTeam.get(canonicalTeam)?.kickoff ?? null : null,
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
console.log(`Sleeper consensus: matched=${sleeperById.size} optional query failures=${sleeperQueryFailures}`);
const consensusWeights = reconciled.map((row) => Number(row.report.diagnostics.sleeperWeight ?? 0));
const strongRescues = reconciled.filter((row) => Number(row.report.diagnostics.sleeperWeight ?? 0) >= 0.25).length;
const consensusMagnitude = (row: typeof reconciled[number]) =>
  Math.abs(Number(row.report.diagnostics.componentConsensusPpr ?? row.report.opportunity_adjusted_ppr) - Number(row.report.diagnostics.roleAdjustedPpr ?? row.report.raw_model_ppr))
  + Math.abs(row.report.final_ppr - Number(row.report.diagnostics.preSleeperPpr ?? row.report.final_ppr));
const consensusThresholds = Object.fromEntries([0.25, 0.5, 1, 2].map((threshold) => [
  threshold,
  reconciled.filter((row) => consensusMagnitude(row) > threshold).length,
]));
const rangeOvershoots = reconciled.filter((row) => {
  const sleeperPpr = row.report.diagnostics.sleeperPpr;
  const preSleeperPpr = row.report.diagnostics.preSleeperPpr;
  if (sleeperPpr == null || preSleeperPpr == null) return false;
  return row.report.final_ppr > Math.max(sleeperPpr, preSleeperPpr) + 0.011
    || row.report.final_ppr < Math.min(sleeperPpr, preSleeperPpr) - 0.011;
}).length;
console.log(`v4.1 consensus rescue: strong=${strongRescues} average Sleeper weight=${(consensusWeights.reduce((sum, value) => sum + value, 0) / Math.max(1, consensusWeights.length)).toFixed(4)} maximum Sleeper weight=${Math.max(0, ...consensusWeights).toFixed(4)}`);
console.log(`Consensus material adjustments: >0.25=${consensusThresholds[0.25]} >0.5=${consensusThresholds[0.5]} >1=${consensusThresholds[1]} >2=${consensusThresholds[2]} range overshoots=${rangeOvershoots}`);
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
    sleeper_consensus: { matched_players: sleeperById.size, query_failures: sleeperQueryFailures, required: false },
    component_ppr_mismatches: componentPprMismatches,
    consensus: {
      strong_rescues: strongRescues,
      average_sleeper_weight: consensusWeights.reduce((sum, value) => sum + value, 0) / Math.max(1, consensusWeights.length),
      maximum_sleeper_weight: Math.max(0, ...consensusWeights),
      material_adjustments: consensusThresholds,
      range_overshoots: rangeOvershoots,
    },
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
if (version === "v4.1") {
  const snapshots = reconciled.flatMap((row) => {
    const common = {
      player_id: row.report.player_id,
      model_version_id: modelVersion.id,
      nfl_game_id: row.report.nfl_game_id,
      season,
      week,
      season_type: "REG",
      retrieved_at: reconciliationRetrievedAt,
      kickoff: row.report.kickoff,
    };
    const evidence: Array<Record<string, unknown>> = [{
      ...common,
      source: "jimmy_raw",
      source_projection_ppr: row.report.raw_model_ppr,
      components: (projections.find((projection) => projection.player_id === row.report.player_id)?.raw_projected_stats
        ?? projections.find((projection) => projection.player_id === row.report.player_id)?.projected_stats
        ?? {}),
      evidence: { version, artifact_stage: "raw" },
    }, {
      ...common,
      source: "jimmy_final",
      source_projection_ppr: row.report.final_ppr,
      components: row.report.projected_stats,
      evidence: row.report.diagnostics,
    }];
    if (row.report.sleeper) evidence.push({
      ...common,
      source: "sleeper",
      source_projection_ppr: row.report.sleeper.ppr,
      components: row.report.sleeper.stats,
      evidence: {
        source_updated_at: row.report.sleeper.sourceUpdatedAt,
        external_game_id: row.report.sleeper.externalGameId,
      },
    });
    if (row.report.vegas_props.length) evidence.push({
      ...common,
      source: "vegas",
      source_projection_ppr: row.report.vegas_ppr,
      components: {},
      evidence: { props: row.report.vegas_props },
    });
    return evidence;
  });
  for (let index = 0; index < snapshots.length; index += 250) {
    const { error } = await db.from("projection_consensus_snapshots").upsert(
      snapshots.slice(index, index + 250),
      { onConflict: "player_id,model_version_id,season,week,season_type,source,retrieved_at" },
    );
    if (error) throw new Error(`Consensus snapshot persistence failed: ${error.message}`);
  }
  console.log(`Persisted ${snapshots.length} timestamped v4.1 consensus snapshots.`);
}
