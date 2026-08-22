import Link from "next/link";
import { SeasonOutlookView } from "@/components/season/season-outlook-view";
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
  if (!user) return <div className="mx-auto max-w-xl"><h1 className="text-3xl font-black">Season Outlook</h1><Card className="mt-5 text-center"><p className="text-slate-300">Season simulations are available in Guest Mode after you choose a Sleeper league.</p><Link href="/guest" className="mt-4 inline-block rounded-xl bg-cyan-400 px-4 py-2 font-black text-slate-950">Continue as Guest</Link></Card></div>;
  const { data: leagues, error: leaguesError } = await db.from("leagues").select("*").eq("owner_id", user.id).not("last_synced_at", "is", null).order("last_synced_at", { ascending: false });
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
  return <SeasonOutlookView
    leagueName={league.name}
    playoffTeams={playoffTeams}
    scheduleSource={scheduleSource}
    simulationCount={simulationCount}
    rankings={rankings}
    playoffChances={playoffChances}
    leagueNavigation={<nav aria-label="Season outlook league" className="mt-4 flex gap-2 overflow-x-auto pb-1">{leagues?.map((item) => <Link key={item.id} href={`/season?leagueId=${item.id}`} className={`shrink-0 rounded-full border px-3 py-2 text-sm font-bold ${item.id === league.id ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 text-slate-400"}`}>{item.name}</Link>)}</nav>}
  />;
}
