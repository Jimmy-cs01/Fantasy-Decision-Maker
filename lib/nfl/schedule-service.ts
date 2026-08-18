import type { createClient } from "../supabase/server";
import { optionalQuery } from "../player-values/optional-query";

type DatabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface WeeklyMatchup {
  id: string;
  nflverseGameId: string;
  season: number;
  week: number;
  kickoff: string | null;
  homeTeam: string;
  awayTeam: string;
  neutralSite: boolean;
  externalGameId: string | null;
  homeSpread: number | null;
  gameTotal: number | null;
  homeImpliedTotal: number | null;
  awayImpliedTotal: number | null;
  booksReporting: number;
  latestUpdate: string | null;
}

interface ConsensusRow {
  nfl_game_id: string | null;
  external_game_id: string;
  consensus_home_spread: number | null;
  consensus_total: number | null;
  consensus_home_implied_total: number | null;
  consensus_away_implied_total: number | null;
  books_reporting: number;
  latest_update: string;
}

export async function getWeeklyMatchups(db: DatabaseClient, season: number, week: number): Promise<WeeklyMatchup[]> {
  const [{ data: games, error }, consensus] = await Promise.all([
    db.from("nfl_games")
      .select("id,nflverse_game_id,season,week,kickoff,home_team,away_team,neutral_site")
      .eq("season", season).eq("week", week).eq("season_type", "REG")
      .order("kickoff", { ascending: true }),
    optionalQuery({
      label: "Vegas consensus lookup failed",
      fallback: [] as ConsensusRow[],
      metadata: { source: "Supabase/odds_games_consensus", season, week },
      query: async () => {
        const result = await db.from("odds_games_consensus").select("nfl_game_id,external_game_id,consensus_home_spread,consensus_total,consensus_home_implied_total,consensus_away_implied_total,books_reporting,latest_update").eq("season", season).eq("week", week);
        if (result.error) throw new Error(result.error.message);
        return (result.data ?? []) as ConsensusRow[];
      },
    }),
  ]);
  if (error) throw new Error(`Unable to load NFL schedule: ${error.message}`);
  const latestConsensus = new Map<string, ConsensusRow>();
  for (const row of consensus) {
    if (!row.nfl_game_id) continue;
    const current = latestConsensus.get(row.nfl_game_id);
    if (!current || row.latest_update > current.latest_update) latestConsensus.set(row.nfl_game_id, row);
  }
  return (games ?? []).map((game) => {
    const odds = latestConsensus.get(game.id);
    return {
      id: game.id,
      nflverseGameId: game.nflverse_game_id,
      season: Number(game.season), week: Number(game.week), kickoff: game.kickoff,
      homeTeam: game.home_team, awayTeam: game.away_team, neutralSite: Boolean(game.neutral_site),
      externalGameId: odds?.external_game_id ?? null,
      homeSpread: odds?.consensus_home_spread == null ? null : Number(odds.consensus_home_spread),
      gameTotal: odds?.consensus_total == null ? null : Number(odds.consensus_total),
      homeImpliedTotal: odds?.consensus_home_implied_total == null ? null : Number(odds.consensus_home_implied_total),
      awayImpliedTotal: odds?.consensus_away_implied_total == null ? null : Number(odds.consensus_away_implied_total),
      booksReporting: Number(odds?.books_reporting ?? 0), latestUpdate: odds?.latest_update ?? null,
    };
  });
}

export function matchupContextByTeam(matchups: WeeklyMatchup[]) {
  return new Map(matchups.flatMap((game) => [
    [game.homeTeam, { opponent: game.awayTeam, isHome: true, kickoff: game.kickoff, teamImpliedTotal: game.homeImpliedTotal, opponentImpliedTotal: game.awayImpliedTotal, spread: game.homeSpread, gameTotal: game.gameTotal }],
    [game.awayTeam, { opponent: game.homeTeam, isHome: false, kickoff: game.kickoff, teamImpliedTotal: game.awayImpliedTotal, opponentImpliedTotal: game.homeImpliedTotal, spread: game.homeSpread == null ? null : -game.homeSpread, gameTotal: game.gameTotal }],
  ]));
}
