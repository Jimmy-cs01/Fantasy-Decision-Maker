import Link from "next/link";
import { DepthChart } from "@/components/nfl/depth-chart";
import { getDepthChartsForTeams } from "@/lib/nfl/depth-chart-service";
import { CURRENT_NFL_TEAMS } from "@/lib/nfl/teams";
import { createClient } from "@/lib/supabase/server";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
export default async function DepthChartsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams; const requested = first(query.team)?.toUpperCase();
  const team = CURRENT_NFL_TEAMS.includes(requested as (typeof CURRENT_NFL_TEAMS)[number]) ? requested! : "BUF";
  const db = await createClient(); const charts = await getDepthChartsForTeams(db, [team], 2026);
  return <div className="mx-auto max-w-4xl"><header><p className="text-xs font-black tracking-[0.2em] text-cyan-300">NFL ROLES</p><h1 className="mt-1 text-3xl font-black">Depth Charts</h1><p className="mt-2 text-sm text-slate-400">Current provider role order with projection and Player Value context. Missing enrichment never removes a player from league rosters.</p></header>
    <nav className="mt-4 flex gap-2 overflow-x-auto pb-2">{CURRENT_NFL_TEAMS.map((item) => <Link key={item} href={`/depth-charts?team=${item}`} className={`min-w-12 rounded-full px-3 py-2 text-center text-sm font-black ${item === team ? "bg-cyan-400 text-slate-950" : "bg-slate-900 text-slate-400"}`}>{item}</Link>)}</nav>
    <div className="mt-4"><DepthChart team={team} players={charts.get(team) ?? []} /></div>
  </div>;
}
