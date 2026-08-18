import Link from "next/link";
import { Card } from "@/components/ui/card";
import { getLeagueRosterAnalytics } from "@/lib/player-values/league-service";
import { buildFallbackSchedule, calculatePowerRankings, simulatePlayoffChances, type SeasonTeamInput } from "@/lib/season/outlook";
import { getSleeperSeasonContext, type ProviderSeasonContext } from "@/lib/season/provider-context";
import { createClient } from "@/lib/supabase/server";

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function SeasonPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: leagues, error: leaguesError } = await db.from("leagues").select("*").eq("owner_id", user!.id).not("last_synced_at", "is", null).order("last_synced_at", { ascending: false });
  if (leaguesError) throw new Error(`Unable to load season leagues: ${leaguesError.message}`);
  const league = leagues?.find((item) => item.id === first(query.leagueId)) ?? leagues?.[0] ?? null;
  if (!league) return <div className="mx-auto max-w-6xl"><h1 className="text-3xl font-black">Season Outlook</h1><Card className="mt-5 text-center"><h2 className="font-bold">Connect a league first</h2><Link className="mt-3 inline-block text-cyan-300" href="/dashboard/connect">Connect a fantasy league →</Link></Card></div>;
  const [{ data: teamsData, error: teamsError }, { data: members }] = await Promise.all([
    db.from("fantasy_teams").select("id,name,wins,losses,ties,league_member_id,sleeper_roster_id,provider_team_id,provider_metadata").eq("league_id", league.id).order("provider_team_id"),
    db.from("league_members").select("id,username,display_name").eq("league_id", league.id),
  ]);
  if (teamsError) throw new Error(`Unable to load season teams: ${teamsError.message}`);
  const membersById = new Map((members ?? []).map((member) => [member.id, member]));
  const teams = (teamsData ?? []).map((team) => ({ ...team, externalId: String(team.provider_team_id ?? team.sleeper_roster_id ?? ""), displayName: team.name || (team.league_member_id ? membersById.get(team.league_member_id)?.display_name || membersById.get(team.league_member_id)?.username : null) || `Team ${team.provider_team_id ?? team.sleeper_roster_id ?? "—"}` }));
  const analytics = await getLeagueRosterAnalytics(db, league, teams);
  const completedWeeks = Math.max(0, ...teams.map((team) => Number(team.wins ?? 0) + Number(team.losses ?? 0) + Number(team.ties ?? 0)));
  let providerContext: ProviderSeasonContext | null = null;
  if (league.provider === "sleeper" && league.sleeper_league_id) {
    try { providerContext = await getSleeperSeasonContext(league.sleeper_league_id, completedWeeks); }
    catch (error) { console.warn("Sleeper season schedule unavailable; using documented balanced fallback", error); }
  }
  const regularSeasonWeeks = providerContext?.regularSeasonWeeks ?? Number(league.provider_metadata?.settings?.playoff_week_start ?? 15) - 1;
  const playoffTeams = Math.min(teams.length, providerContext?.playoffTeams ?? Number(league.provider_metadata?.settings?.playoff_teams ?? (teams.length >= 10 ? 6 : 4)));
  const baseInputs: SeasonTeamInput[] = teams.map((team) => {
    const roster = analytics.rostersByTeam.get(team.id) ?? [];
    const summary = analytics.teamSummaries.get(team.id);
    const starterIds = new Set(summary?.optimalStarterIds ?? []);
    const starters = roster.filter((player) => starterIds.has(player.id));
    const range = starters.reduce((sum, player) => sum + Math.max(0, Number(player.projection_ceiling ?? player.projected_ppg ?? 0) - Number(player.projection_floor ?? player.projected_ppg ?? 0)), 0);
    return {
      id: team.id,
      name: team.displayName,
      wins: Number(team.wins ?? 0), losses: Number(team.losses ?? 0), ties: Number(team.ties ?? 0),
      pointsFor: providerContext?.pointsForByExternalTeam.get(team.externalId) ?? 0,
      projectedPpg: Number(summary?.projectedPpg ?? 0),
      projectionSd: Math.max(10, range / Math.max(2.56, Math.sqrt(Math.max(1, starters.length)))),
      rosterValue: roster.reduce((sum, player) => sum + Math.max(0, Number(player.player_value ?? 0)), 0),
      allPlayWinPct: providerContext?.allPlayWinPctByExternalTeam.get(team.externalId) ?? null,
    };
  });
  const availablePpg = baseInputs.filter((team) => team.projectedPpg > 0).map((team) => team.projectedPpg);
  const averagePpg = availablePpg.length ? availablePpg.reduce((sum, value) => sum + value, 0) / availablePpg.length : 100;
  const inputs = baseInputs.map((team) => team.projectedPpg > 0 ? team : { ...team, projectedPpg: averagePpg, projectionSd: 20 });
  const internalByExternal = new Map(teams.map((team) => [team.externalId, team.id]));
  const providerSchedule = (providerContext?.remainingMatchups ?? []).flatMap((matchup) => {
    const teamAId = internalByExternal.get(matchup.externalTeamA); const teamBId = internalByExternal.get(matchup.externalTeamB);
    return teamAId && teamBId ? [{ week: matchup.week, teamAId, teamBId }] : [];
  });
  const gamesRemaining = Math.max(0, regularSeasonWeeks - completedWeeks);
  const schedule = providerSchedule.length ? providerSchedule : buildFallbackSchedule(teams.map((team) => team.id), gamesRemaining, completedWeeks + 1);
  const simulationCount = 5_000;
  const playoffChances = simulatePlayoffChances({ teams: inputs, schedule, playoffTeams, simulations: simulationCount, seed: Number(league.season) * 100 + completedWeeks });
  const rankings = calculatePowerRankings(inputs, schedule);
  const scheduleSource = providerSchedule.length ? `${league.provider} matchup schedule` : "balanced round-robin fallback";
  return <div className="mx-auto max-w-7xl">
    <header><p className="text-xs font-black tracking-[.2em] text-cyan-300">LEAGUE ANALYTICS</p><h1 className="mt-1 text-3xl font-black">Jimmy GM Season Outlook</h1><p className="mt-2 text-sm text-slate-400">Results, optimized lineup strength, roster value, remaining schedule, and {simulationCount.toLocaleString()} seeded playoff simulations.</p></header>
    <nav aria-label="Season outlook league" className="mt-4 flex gap-2 overflow-x-auto pb-1">{leagues?.map((item) => <Link key={item.id} href={`/season?leagueId=${item.id}`} className={`shrink-0 rounded-full border px-3 py-2 text-sm font-bold ${item.id === league.id ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 text-slate-400"}`}>{item.name}</Link>)}</nav>
    <Card className="mt-5 overflow-hidden p-0"><div className="border-b border-slate-800 px-4 py-3"><h2 className="font-black">Season Rankings & Playoff Chances</h2><p className="mt-1 text-xs text-slate-500">{league.name} · {playoffTeams} playoff teams · schedule: {scheduleSource}</p></div>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-950/80 text-left text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Rank</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Record</th><th className="px-4 py-3">Points For</th><th className="px-4 py-3">Starting PPG</th><th className="px-4 py-3">Roster Value</th><th className="px-4 py-3">Playoff Chance</th></tr></thead><tbody className="divide-y divide-slate-800">{rankings.map((team) => <tr key={team.id}><td className="px-4 py-3 font-black text-cyan-300">{team.rank}</td><td className="px-4 py-3"><b>{team.name}</b><p className="text-xs text-slate-500">Power {team.powerScore.toFixed(1)}</p></td><td className="px-4 py-3">{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ""}</td><td className="px-4 py-3 tabular-nums">{team.pointsFor ? team.pointsFor.toFixed(1) : "—"}</td><td className="px-4 py-3 tabular-nums">{team.projectedPpg.toFixed(1)}</td><td className="px-4 py-3 tabular-nums">{team.rosterValue.toFixed(1)}</td><td className="px-4 py-3 font-black tabular-nums text-cyan-200">{playoffChances.get(team.id)?.toFixed(1) ?? "—"}%</td></tr>)}</tbody></table></div>
      <div className="divide-y divide-slate-800 md:hidden">{rankings.map((team) => <article key={team.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><span className="mr-2 font-black text-cyan-300">#{team.rank}</span><b>{team.name}</b><p className="mt-1 text-xs text-slate-500">{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ""} · Power {team.powerScore.toFixed(1)}</p></div><div className="text-right"><b className="text-xl text-cyan-200">{playoffChances.get(team.id)?.toFixed(0) ?? "—"}%</b><p className="text-[9px] text-slate-500">PLAYOFFS</p></div></div><dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><Metric label="Proj PPG" value={team.projectedPpg.toFixed(1)} /><Metric label="Roster value" value={team.rosterValue.toFixed(1)} /><Metric label="Points for" value={team.pointsFor ? team.pointsFor.toFixed(1) : "—"} /></dl></article>)}</div>
    </Card>
    <p className="mt-4 text-xs text-slate-500">Power score weights: 35% current performance, 30% optimized lineup projection, 20% roster value, 15% remaining schedule. Simulations use projected lineup uncertainty and qualify teams by wins, ties, then points. Divisions and provider-specific tiebreakers are not modeled; when a future schedule is unavailable, the displayed balanced fallback is used.</p>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><dt className="text-[9px] font-black uppercase text-slate-600">{label}</dt><dd className="mt-0.5 font-bold">{value}</dd></div>; }
