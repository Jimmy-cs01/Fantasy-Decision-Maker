import Link from "next/link";
import { MatchupCard } from "@/components/nfl/matchup-card";
import { getDepthChartsForTeams } from "@/lib/nfl/depth-chart-service";
import { getWeeklyMatchups } from "@/lib/nfl/schedule-service";
import { createClient } from "@/lib/supabase/server";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
export default async function MatchupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const season = Number(first(query.season) ?? 2026);
  const week = Math.max(1, Math.min(18, Number(first(query.week) ?? 1)));
  const db = await createClient();
  let games: Awaited<ReturnType<typeof getWeeklyMatchups>> = [];
  try { games = await getWeeklyMatchups(db, season, week); }
  catch (error) { console.error("NFL matchup page could not load its canonical schedule", error); }
  const teams = [...new Set(games.flatMap((game) => [game.awayTeam, game.homeTeam]))];
  const depthCharts = await getDepthChartsForTeams(db, teams, season);
  return <div className="mx-auto max-w-6xl">
    <header><p className="text-xs font-black tracking-[0.2em] text-cyan-300">FANTASY MATCHUPS</p><h1 className="mt-1 text-3xl font-black">NFL Week {week}</h1><p className="mt-2 text-sm text-slate-400">Canonical nflverse schedule enriched by median sportsbook consensus. Lines are context, not picks.</p></header>
    <nav aria-label="NFL week" className="mt-4 flex gap-2 overflow-x-auto pb-2">{Array.from({ length: 18 }, (_, index) => index + 1).map((item) => <Link key={item} href={`/matchups?season=${season}&week=${item}`} className={`min-w-11 rounded-full px-3 py-2 text-center text-sm font-black ${item === week ? "bg-cyan-400 text-slate-950" : "bg-slate-900 text-slate-400"}`}>{item}</Link>)}</nav>
    <div className="mt-4 grid gap-4 xl:grid-cols-2">{games.map((game) => <MatchupCard key={game.id} game={game} depthCharts={depthCharts} />)}</div>
    {!games.length ? <p className="mt-5 rounded-2xl border border-dashed border-slate-700 p-6 text-center text-slate-400">No schedule rows are available for {season} Week {week}. Import the canonical nflverse schedule; Vegas lines may remain — until books publish them.</p> : null}
  </div>;
}
