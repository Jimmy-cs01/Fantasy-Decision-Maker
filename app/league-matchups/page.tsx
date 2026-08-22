import Link from "next/link";
import { HeadToHeadSchedule } from "@/components/league/head-to-head-schedule";
import { Card } from "@/components/ui/card";
import { buildHeadToHeadSchedule } from "@/lib/leagues/head-to-head";
import { projectLeagueSchedule } from "@/lib/leagues/projection-schedule";
import { loadSavedSleeperWorkspace } from "@/lib/leagues/saved-workspace";
import { sleeperClient } from "@/lib/sleeper/client";
import { createClient } from "@/lib/supabase/server";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function LeagueMatchupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return <GuestPrompt />;
  const workspace = await loadSavedSleeperWorkspace(db, user.id, first(query.leagueId));
  if (!workspace.league || !workspace.analytics) return <ConnectPrompt />;
  const matchupRows = await Promise.all(Array.from({ length: 17 }, (_, index) => sleeperClient.getMatchups(workspace.league.sleeper_league_id, index + 1)
    .catch((error) => {
      console.warn(`Sleeper matchup lookup failed for week ${index + 1}; continuing with published weeks`, error);
      return [];
    })));
  const schedule = await projectLeagueSchedule({
    db,
    season: Number(workspace.league.season),
    teams: workspace.teams.map((team) => ({ id: team.id, players: team.players })),
    rosterPositions: workspace.league.roster_positions ?? [],
    scoringSettings: workspace.league.scoring_settings ?? { rec: 1 },
  });
  const rows = buildHeadToHeadSchedule({
    teams: workspace.teams,
    matchupRowsByWeek: new Map(matchupRows.map((rows, index) => [index + 1, rows])),
    projections: schedule.projections,
    currentWeek: schedule.currentWeek,
  });
  const playerNames = Object.fromEntries(workspace.analytics.projectionPool.map((player) => [player.id, player.full_name]));
  return <div className="mx-auto max-w-6xl"><header><p className="text-xs font-black tracking-[.2em] text-cyan-300">FANTASY SCHEDULE</p><h1 className="mt-1 text-3xl font-black">Weekly Matchups</h1><p className="mt-2 text-sm text-slate-400">{workspace.league.name} · actual Sleeper schedule · league-adjusted optimal projected lineups.</p></header><nav className="mt-4 flex gap-2 overflow-x-auto pb-1">{workspace.leagues.map((league) => <Link key={league.id} href={`/league-matchups?leagueId=${league.id}`} className={`shrink-0 rounded-full border px-3 py-2 text-sm font-bold ${league.id === workspace.league.id ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 text-slate-400"}`}>{league.name}</Link>)}</nav><div className="mt-5"><HeadToHeadSchedule rows={rows} currentWeek={schedule.currentWeek} playerNames={playerNames} dstMessage={schedule.dstCoverage.projectionEnabled ? null : schedule.dstCoverage.reason} /></div></div>;
}

function GuestPrompt() { return <div className="mx-auto max-w-xl"><h1 className="text-3xl font-black">League Schedule</h1><Card className="mt-5 text-center"><p className="text-slate-300">You can view your Sleeper head-to-head schedule in Guest Mode without creating an account.</p><Link href="/guest" className="mt-4 inline-block rounded-xl bg-cyan-400 px-4 py-2 font-black text-slate-950">Continue as Guest</Link></Card></div>; }
function ConnectPrompt() { return <div className="mx-auto max-w-xl"><h1 className="text-3xl font-black">League Schedule</h1><Card className="mt-5 text-center"><p className="text-slate-300">Connect a Sleeper league to load its head-to-head schedule.</p><Link href="/dashboard/connect" className="mt-4 inline-block font-black text-cyan-300">Connect Sleeper →</Link></Card></div>; }
