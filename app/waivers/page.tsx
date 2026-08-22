import Link from "next/link";
import { Card } from "@/components/ui/card";
import { WaiverWire } from "@/components/waivers/waiver-wire";
import { loadSavedSleeperWorkspace } from "@/lib/leagues/saved-workspace";
import { sleeperClient } from "@/lib/sleeper/client";
import { createClient } from "@/lib/supabase/server";
import { buildWaiverWire, type SleeperTransactionLike } from "@/lib/waivers/availability";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function WaiversPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return <GuestPrompt title="Waiver Wire" />;
  const workspace = await loadSavedSleeperWorkspace(db, user.id, first(query.leagueId));
  if (!workspace.league || !workspace.analytics) return <ConnectPrompt title="Waiver Wire" />;
  const [rosters, transactions] = await Promise.all([
    sleeperClient.getRosters(workspace.league.sleeper_league_id),
    sleeperClient.getTransactions(workspace.league.sleeper_league_id, workspace.analytics.projectionWeek ?? 1)
      .catch((error) => {
        console.warn("Sleeper waiver transaction lookup failed; continuing with roster availability", error);
        return [];
      }) as Promise<SleeperTransactionLike[]>,
  ]);
  const players = buildWaiverWire({
    projectionPool: workspace.analytics.projectionPool,
    rosteredPlayerIds: rosters.flatMap((roster) => roster.players ?? []),
    transactions,
  });
  return <div className="mx-auto max-w-6xl"><header><p className="text-xs font-black tracking-[.2em] text-cyan-300">AVAILABLE IN YOUR LEAGUE</p><h1 className="mt-1 text-3xl font-black">Waiver Wire</h1><p className="mt-2 text-sm text-slate-400">Players currently unrostered in {workspace.league.name}, ranked by league-adjusted Player Value and projected PPG.</p></header><LeagueNav leagues={workspace.leagues.map((league) => ({ id: String(league.id), name: String(league.name) }))} selected={workspace.league.id} path="/waivers" /><div className="mt-5"><WaiverWire players={players} playerQuery={`?scoring=league&leagueId=${workspace.league.id}`} /></div></div>;
}

function LeagueNav({ leagues, selected, path }: { leagues: Array<{ id: string; name: string }>; selected: string; path: string }) { return <nav className="mt-4 flex gap-2 overflow-x-auto pb-1">{leagues.map((league) => <Link key={league.id} href={`${path}?leagueId=${league.id}`} className={`shrink-0 rounded-full border px-3 py-2 text-sm font-bold ${league.id === selected ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 text-slate-400"}`}>{league.name}</Link>)}</nav>; }
function GuestPrompt({ title }: { title: string }) { return <div className="mx-auto max-w-xl"><h1 className="text-3xl font-black">{title}</h1><Card className="mt-5 text-center"><p className="text-slate-300">Continue as Guest, enter your Sleeper username, and choose a league. No JimmyGM account is required.</p><Link href="/guest" className="mt-4 inline-block rounded-xl bg-cyan-400 px-4 py-2 font-black text-slate-950">Continue as Guest</Link></Card></div>; }
function ConnectPrompt({ title }: { title: string }) { return <div className="mx-auto max-w-xl"><h1 className="text-3xl font-black">{title}</h1><Card className="mt-5 text-center"><p className="text-slate-300">Connect a Sleeper league to see player availability.</p><Link href="/dashboard/connect" className="mt-4 inline-block font-black text-cyan-300">Connect Sleeper →</Link></Card></div>; }
