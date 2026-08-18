import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { uniquePlayerNameMatches, normalizePlayerName } from "../lib/odds/player-matching";
import { TheOddsApiProvider } from "../lib/odds/the-odds-api";
import { matchOddsGameToSchedule } from "../lib/odds/game-mapping";

loadEnvConfig(process.cwd());

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const season = Number(argument("--season"));
const week = Number(argument("--week"));
const includeProps = process.argv.includes("--props");
const dryRun = process.argv.includes("--dry-run");
const eventIds = (argument("--event-ids") ?? "").split(",").filter(Boolean);

if (!Number.isInteger(season) || !Number.isInteger(week)) {
  throw new Error("Usage: npm run data:odds:sync -- --season 2026 --week 1 [--props] [--event-ids id,id] [--dry-run]");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const provider = new TheOddsApiProvider();

const { data: schedule, error: scheduleError } = await db
  .from("nfl_games")
  .select("id,nflverse_game_id,home_team,away_team,kickoff")
  .eq("season", season)
  .eq("week", week)
  .eq("season_type", "REG");
if (scheduleError) throw new Error(`Unable to load canonical schedule: ${scheduleError.message}`);
if (!schedule?.length) throw new Error(`No canonical ${season} Week ${week} games. Run npm run data:schedules:import first.`);

const featured = await provider.getGames(season, week);
const mapped = featured.flatMap((line) => {
  const game = matchOddsGameToSchedule(line, schedule);
  if (!game) {
    console.warn(`Skipping unmapped Odds API event ${line.externalGameId}: ${line.awayTeam} @ ${line.homeTeam}`);
    return [];
  }
  return [{
    nfl_game_id: game.id,
    external_game_id: line.externalGameId,
    season: line.season,
    week: line.week,
    commence_time: line.commenceTime,
    home_team: line.homeTeam,
    away_team: line.awayTeam,
    provider: line.provider,
    sportsbook: line.sportsbook,
    home_spread: line.homeSpread,
    game_total: line.gameTotal,
    home_moneyline: line.homeMoneyline,
    away_moneyline: line.awayMoneyline,
    home_implied_total: line.homeImpliedTotal,
    away_implied_total: line.awayImpliedTotal,
    captured_at: line.capturedAt,
  }];
});

console.log(`Featured odds: ${featured.length} sportsbook rows; ${mapped.length} mapped to ${schedule.length} canonical games.`);
console.log(`Quota: used=${provider.quota.requestsUsed ?? "?"} remaining=${provider.quota.requestsRemaining ?? "?"} last=${provider.quota.requestsLast ?? "?"}`);
if (dryRun) {
  console.log("Dry run: no remote writes performed. Note: the live Odds API request still consumed quota when data was returned.");
  process.exit(0);
}

const { data: savedOdds, error: oddsError } = await db
  .from("odds_games")
  .upsert(mapped, { onConflict: "provider,sportsbook,external_game_id,captured_at" })
  .select("id,external_game_id,sportsbook");
if (oddsError) throw new Error(`Unable to persist sportsbook odds: ${oddsError.message}`);
console.log(`Persisted ${savedOdds?.length ?? 0} idempotent sportsbook snapshots.`);

if (includeProps) {
  const selectedEvents = [...new Set(mapped.map((row) => row.external_game_id))]
    .filter((id) => !eventIds.length || eventIds.includes(id));
  const { data: players, error: playersError } = await db
    .from("players")
    .select("id,full_name")
    .in("position", ["QB", "RB", "WR", "TE", "K"]);
  if (playersError) throw new Error(`Unable to load prop player identities: ${playersError.message}`);
  const nameMatches = uniquePlayerNameMatches((players ?? []).map((player) => ({ id: player.id, name: player.full_name })));
  const oddsIds = new Map((savedOdds ?? []).map((row) => [`${row.external_game_id}:${row.sportsbook}`, row.id]));
  const propRows = [];
  let skipped = 0;
  for (const eventId of selectedEvents) {
    const props = await provider.getPlayerPropsForEvent(eventId);
    console.log(`Props ${eventId}: ${props.length} sportsbook markets; quota remaining=${provider.quota.requestsRemaining ?? "?"}`);
    for (const prop of props) {
      const player = nameMatches.get(normalizePlayerName(prop.playerName));
      const oddsGameId = oddsIds.get(`${eventId}:${prop.sportsbook}`);
      if (!player || !oddsGameId) {
        skipped += 1;
        continue;
      }
      propRows.push({
        player_id: player.id,
        odds_game_id: oddsGameId,
        provider: prop.provider,
        sportsbook: prop.sportsbook,
        market: prop.market,
        line: prop.line,
        over_odds: prop.overOdds,
        under_odds: prop.underOdds,
        captured_at: prop.capturedAt,
      });
    }
  }
  if (propRows.length) {
    const { error } = await db.from("player_props").upsert(propRows, {
      onConflict: "player_id,odds_game_id,provider,sportsbook,market,captured_at",
    });
    if (error) throw new Error(`Unable to persist player props: ${error.message}`);
  }
  console.log(`Persisted ${propRows.length} player-prop snapshots; skipped ${skipped} ambiguous/unmapped rows.`);
}
