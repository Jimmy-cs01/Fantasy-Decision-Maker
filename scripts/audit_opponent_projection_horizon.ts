import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { CURRENT_NFL_TEAMS, normalizeNflTeam } from "../lib/nfl/teams";
import { opponentStrength } from "../lib/projections/opponent-adjustment";
import { calculateProjectedFantasyPoints } from "../lib/projections/scoring";
import type { ProjectedStatLine } from "../lib/projections/types";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase URL and service role key are required.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const season = 2026;

const { data: model, error: modelError } = await db.from("model_versions")
  .select("id,version,is_active").eq("is_active", true).maybeSingle();
if (modelError || !model) throw new Error(`Active model lookup failed: ${modelError?.message ?? "missing"}`);

type Row = {
  player_id: string; week: number; team: string | null; opponent_team: string | null;
  projected_stats: ProjectedStatLine; projected_points_ppr: number; generated_at: string;
  projection_diagnostics: Record<string, unknown> | null;
};
const rows: Row[] = [];
for (let start = 0; ; start += 1000) {
  const { data, error } = await db.from("player_projections")
    .select("player_id,week,team,opponent_team,projected_stats,projected_points_ppr,generated_at,projection_diagnostics")
    .eq("season", season).eq("season_type", "REG").eq("model_version_id", model.id)
    .order("player_id").order("week").range(start, start + 999);
  if (error) throw new Error(`Projection page failed: ${error.message}`);
  rows.push(...((data ?? []) as Row[]));
  if ((data ?? []).length < 1000) break;
}
const playerIds = [...new Set(rows.map((row) => row.player_id))];
const players = new Map<string, { name: string; position: string }>();
for (let start = 0; start < playerIds.length; start += 100) {
  const { data, error } = await db.from("players").select("id,full_name,sleeper_position,historical_position")
    .in("id", playerIds.slice(start, start + 100));
  if (error) throw new Error(`Player lookup failed: ${error.message}`);
  for (const player of data ?? []) players.set(player.id, {
    name: player.full_name,
    position: String(player.sleeper_position ?? player.historical_position ?? "").toUpperCase(),
  });
}
const { data: games, error: gamesError } = await db.from("nfl_games")
  .select("week,home_team,away_team").eq("season", season).eq("season_type", "REG");
if (gamesError) throw new Error(`Schedule lookup failed: ${gamesError.message}`);
const schedule = new Map<string, string>();
for (const game of games ?? []) {
  const home = normalizeNflTeam(game.home_team);
  const away = normalizeNflTeam(game.away_team);
  if (!home || !away) continue;
  schedule.set(`${game.week}:${home}`, away);
  schedule.set(`${game.week}:${away}`, home);
}

const byPlayer = new Map<string, Row[]>();
for (const row of rows) byPlayer.set(row.player_id, [...(byPlayer.get(row.player_id) ?? []), row]);
const breakdown = Object.fromEntries(["QB", "RB", "WR", "TE"].map((position) => [position, { eligible: 0, nonzero: 0, allZero: 0 }]));
const traces: Record<string, unknown>[] = [];
const excludedPlayers: Record<string, unknown>[] = [];
let eligible = 0;
let nonzero = 0;
let allZero = 0;
let storedMaterialized = 0;
let legacyAllZero = 0;
let legacyFutureRamsPlayers = 0;
let legacyFutureRamsRows = 0;
const legacyAllZeroBreakdown = Object.fromEntries(["QB", "RB", "WR", "TE"].map((position) => [position, 0]));
for (const [playerId, playerRows] of byPlayer) {
  const player = players.get(playerId);
  const seed = playerRows.find((row) => Number(row.week) === 1);
  const team = normalizeNflTeam(seed?.team ?? "");
  const seedOpponent = normalizeNflTeam(seed?.opponent_team ?? "");
  if (!player || !team || !seedOpponent || !breakdown[player.position]) {
    excludedPlayers.push({ playerId, player: player?.name ?? playerId, position: player?.position ?? null, reason: !team ? "missing current team" : !seedOpponent ? "missing seed opponent" : "unsupported position" });
    continue;
  }
  const seedStrength = opponentStrength(player.position, seedOpponent);
  const future = playerRows.filter((row) => Number(row.week) >= 2 && schedule.has(`${row.week}:${team}`));
  if (future.length < 2) {
    excludedPlayers.push({ playerId, player: player.name, position: player.position, reason: "fewer than two scheduled future games", futureGames: future.length });
    continue;
  }
  eligible += 1;
  breakdown[player.position].eligible += 1;
  if (seedOpponent === "LAR") {
    legacyAllZero += 1;
    legacyAllZeroBreakdown[player.position] += 1;
  }
  let hasAdjustment = false;
  let hasFutureRams = false;
  for (const row of future) {
    if (row.projection_diagnostics?.opponentAdjustmentMethod === "relative_to_seed_matchup") storedMaterialized += 1;
    const opponent = schedule.get(`${row.week}:${team}`) ?? null;
    if (opponent === "LAR") {
      hasFutureRams = true;
      legacyFutureRamsRows += 1;
    }
    const strength = opponentStrength(player.position, opponent);
    const cap = strength?.softCapPpg ?? 0;
    const adjustment = strength && seedStrength
      ? Math.max(-cap, Math.min(cap, strength.adjustmentPpg - seedStrength.adjustmentPpg))
      : 0;
    if (Math.abs(adjustment) > 1e-9) hasAdjustment = true;
    if (player.name === "Christian McCaffrey" || (player.name === "Saquon Barkley" && Number(row.week) === 2)) {
      const base = calculateProjectedFantasyPoints(row.projected_stats, { rec: 1 }, player.position);
      traces.push({
        player: player.name, position: player.position, week: Number(row.week), opponent,
        seedOpponent, baseProjection: base, opponentMetric: strength?.pointsAllowedPerGame ?? null,
        opponentRank: strength?.rank ?? null, seedMetric: seedStrength?.pointsAllowedPerGame ?? null,
        relativeMetricDifference: strength && seedStrength ? strength.pointsAllowedPerGame - seedStrength.pointsAllowedPerGame : null,
        matchupAdjustment: adjustment, positionCap: cap, adjustedProjection: base + adjustment,
        generatedAt: row.generated_at,
      });
    }
  }
  if (hasFutureRams) legacyFutureRamsPlayers += 1;
  if (hasAdjustment) {
    nonzero += 1;
    breakdown[player.position].nonzero += 1;
  } else {
    allZero += 1;
    breakdown[player.position].allZero += 1;
  }
}
const missingLookup = Object.fromEntries(["QB", "RB", "WR", "TE"].map((position) => [position,
  CURRENT_NFL_TEAMS.filter((team) => !opponentStrength(position, team)),
]));
const report = {
  generatedAt: new Date().toISOString(), activeModel: model.version, activeModelId: model.id,
  projectionRows: rows.length, projectedPlayers: byPlayer.size, eligiblePlayers: eligible,
  playersWithNonzeroAdjustment: nonzero, playersWithAllZeroAdjustments: allZero,
  breakdown, missingLookup, excludedPlayers, storedMaterializedRows: storedMaterialized,
  legacyBug: {
    playersWithAllZeroAdjustments: legacyAllZero,
    allZeroBreakdown: legacyAllZeroBreakdown,
    playersWithAtLeastOneSkippedFutureRamsMatchup: legacyFutureRamsPlayers,
    skippedFutureRamsRows: legacyFutureRamsRows,
  },
  traces,
};
writeFileSync("data/processed/opponent_horizon_audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
