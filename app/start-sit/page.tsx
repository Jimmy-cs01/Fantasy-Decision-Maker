import Link from "next/link";
import { StartSitComparator } from "@/components/start-sit/start-sit-comparator";
import { Card } from "@/components/ui/card";
import { getStartSitProjectionPool } from "@/lib/start-sit/service";
import { resolveStartSitScoringSettings } from "@/lib/start-sit/decision";
import { createClient } from "@/lib/supabase/server";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function StartSitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: leagues, error: leagueError } = await db.from("leagues").select("id,name,provider,total_rosters,roster_positions,scoring_settings,last_synced_at").eq("owner_id", user!.id).not("last_synced_at", "is", null).order("last_synced_at", { ascending: false });
  if (leagueError) throw new Error(`Unable to load Start / Sit leagues: ${leagueError.message}`);
  const league = leagues?.find((item) => item.id === first(query.leagueId)) ?? leagues?.[0] ?? null;
  const manual = first(query.scoring);
  const scoringMode = manual === "standard" || manual === "half_ppr" ? manual : "ppr";
  const scoringSettings = resolveStartSitScoringSettings(league?.scoring_settings, scoringMode);
  const projectionPool = await getStartSitProjectionPool(db, scoringSettings);
  let players = projectionPool.players;
  let rosterLabel = "All projected fantasy players";
  if (league) {
    const [{ data: teams }, { data: members }, { data: sleeperAccount }] = await Promise.all([
      db.from("fantasy_teams").select("id,league_member_id,provider_metadata").eq("league_id", league.id),
      db.from("league_members").select("id,sleeper_user_id").eq("league_id", league.id),
      db.from("sleeper_accounts").select("sleeper_user_id").eq("user_id", user!.id).limit(1).maybeSingle(),
    ]);
    const memberId = members?.find((member) => member.sleeper_user_id === sleeperAccount?.sleeper_user_id)?.id;
    const myTeam = teams?.find((team) => team.league_member_id === memberId || team.provider_metadata?.is_user_team === true) ?? teams?.[0];
    if (myTeam) {
      const { data: roster } = await db.from("rosters").select("id").eq("fantasy_team_id", myTeam.id).maybeSingle();
      if (roster) {
        const { data: entries } = await db.from("roster_players").select("player_id").eq("roster_id", roster.id);
        const rosterIds = new Set((entries ?? []).map((entry) => entry.player_id));
        players = projectionPool.players.filter((player) => rosterIds.has(player.id));
        rosterLabel = "Your synchronized roster";
      }
    }
  }
  return <div className="mx-auto max-w-6xl">
    <header><p className="text-xs font-black tracking-[.2em] text-cyan-300">LINEUP DECISIONS</p><h1 className="mt-1 text-3xl font-black">Start / Sit</h1><p className="mt-2 text-sm text-slate-400">Compare Jimmy GM&apos;s final reconciled weekly projections. {rosterLabel} · {projectionPool.season ? `${projectionPool.season} Week ${projectionPool.week}` : "projection week unavailable"}.</p></header>
    {leagues?.length ? <nav aria-label="Start Sit league" className="mt-4 flex gap-2 overflow-x-auto pb-1">{leagues.map((item) => <Link key={item.id} href={`/start-sit?leagueId=${item.id}`} className={`shrink-0 rounded-full border px-3 py-2 text-sm font-bold ${league?.id === item.id ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 text-slate-400"}`}>{item.name}</Link>)}</nav> : <form className="mt-4"><label className="text-xs font-bold text-slate-400">Scoring<select name="scoring" defaultValue={scoringMode} className="ml-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="standard">Standard</option><option value="half_ppr">Half PPR</option><option value="ppr">PPR</option></select></label><button className="ml-2 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-black text-slate-950">Apply</button></form>}
    <div className="mt-5">{players.length ? <StartSitComparator players={players} rosterPositions={league?.roster_positions ?? []} /> : <Card className="text-center"><h2 className="font-bold">No roster projections available</h2><p className="mt-2 text-slate-400">Sync a league or import the current projection week to compare players.</p></Card>}</div>
  </div>;
}
