"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChartNoAxesCombined, LogIn } from "lucide-react";
import { LeagueRoster } from "@/components/dashboard/league-roster";
import { TeamSelector } from "@/components/dashboard/team-selector";
import { StartSitComparator } from "@/components/start-sit/start-sit-comparator";
import { TradeFinder, type TradeTeam } from "@/components/trades/trade-finder";
import { Card } from "@/components/ui/card";
import { guestLeagueHref, readGuestSession, writeGuestSession, type GuestSession } from "@/lib/guest/session";
import { useGuestSession } from "@/lib/guest/use-guest-session";
import { buildFallbackSchedule, calculatePowerRankings, simulatePlayoffChances, type SeasonTeamInput } from "@/lib/season/outlook";
import type { StartSitPlayer } from "@/lib/start-sit/service";
import type { LeagueAnalyticsPlayer, TeamProjectionSummary } from "@/lib/player-values/league-service";

interface GuestTeam {
  id: string;
  sleeperRosterId: number;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  isMyTeam: boolean;
  players: LeagueAnalyticsPlayer[];
  summary: TeamProjectionSummary | null;
}

interface GuestLeaguePayload {
  league: {
    id: string;
    name: string;
    season: number;
    seasonType: string;
    totalRosters: number;
    rosterPositions: string[];
    scoringSettings: Record<string, number>;
    settings: Record<string, unknown>;
  };
  guest: { sleeperUserId: string; sleeperUsername: string };
  teams: GuestTeam[];
  analyticsAvailable: boolean;
  projectionSeason: number | null;
  projectionWeek: number | null;
}

const VIEWS = [
  ["overview", "League Overview"],
  ["trades", "Trade Finder"],
  ["start-sit", "Start / Sit"],
  ["season", "Season Outlook"],
] as const;

export function GuestLeagueWorkspace({ leagueId }: { leagueId: string }) {
  const query = useSearchParams();
  const requestedView = query.get("view");
  const view = VIEWS.some(([id]) => id === requestedView) ? requestedView! : "overview";
  const session = useGuestSession();
  const [result, setResult] = useState<{
    leagueId: string;
    payload: GuestLeaguePayload | null;
    error: string;
  } | null>(null);

  useEffect(() => {
    const current = readGuestSession();
    if (!current) return;
    writeGuestSession({ ...current, selectedLeagueId: leagueId });
    const controller = new AbortController();
    fetch(`/api/guest/sleeper/league/${encodeURIComponent(leagueId)}?username=${encodeURIComponent(current.sleeperUsername)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to load guest league.");
        setResult({ leagueId, payload: result, error: "" });
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setResult({
          leagueId,
          payload: null,
          error: cause instanceof Error ? cause.message : "Unable to load guest league.",
        });
      });
    return () => controller.abort();
  }, [leagueId]);

  if (session === null) return <GuestExpired />;
  if (!result || result.leagueId !== leagueId) return <GuestShell><p className="rounded-xl border border-slate-800 p-6 text-slate-400">Loading public Sleeper league data…</p></GuestShell>;
  if (result.error || !result.payload) return <GuestShell session={session}><Card className="text-center"><h1 className="text-xl font-black">Guest league unavailable</h1><p className="mt-2 text-slate-400">{result.error || "The guest session could not load this league."}</p><Link href="/guest" className="mt-4 inline-block font-black text-cyan-300">Choose another league →</Link></Card></GuestShell>;
  const payload = result.payload;

  const signupNext = `/dashboard/connect?guestUsername=${encodeURIComponent(session.sleeperUsername)}&guestLeagueId=${encodeURIComponent(leagueId)}`;
  return <GuestShell session={session} leagueId={leagueId}>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4">
      <div><p className="text-xs font-black tracking-[.18em] text-amber-200">GUEST SESSION</p><p className="mt-1 text-sm text-slate-300">Browsing {payload.league.name} as {session.sleeperUsername}. This connection disappears when the browser session ends.</p></div>
      <Link href={`/signup?next=${encodeURIComponent(signupNext)}`} className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-black text-slate-950">Sign Up / Save My League</Link>
    </div>
    <nav aria-label="Guest league features" className="mb-5 flex gap-2 overflow-x-auto pb-1">
      {VIEWS.map(([id, label]) => <Link key={id} href={guestLeagueHref(leagueId, id)} className={`shrink-0 rounded-full border px-3 py-2 text-sm font-bold ${view === id ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 text-slate-400"}`}>{label}</Link>)}
      <Link href="/matchups" className="shrink-0 rounded-full border border-slate-800 px-3 py-2 text-sm font-bold text-slate-400">Matchups</Link>
      <Link href="/depth-charts" className="shrink-0 rounded-full border border-slate-800 px-3 py-2 text-sm font-bold text-slate-400">Depth Charts</Link>
      <Link href="/players" className="shrink-0 rounded-full border border-slate-800 px-3 py-2 text-sm font-bold text-slate-400">Players</Link>
    </nav>
    {view === "overview" ? <GuestOverview payload={payload} teamId={query.get("teamId")} /> : null}
    {view === "trades" ? <GuestTrades payload={payload} /> : null}
    {view === "start-sit" ? <GuestStartSit payload={payload} /> : null}
    {view === "season" ? <GuestSeason payload={payload} /> : null}
  </GuestShell>;
}

function GuestShell({ children, session, leagueId }: { children: React.ReactNode; session?: GuestSession | null; leagueId?: string }) {
  return <div className="min-h-screen">
    <header className="border-b border-slate-800 bg-slate-950/80 px-4 py-3">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4"><Link href={leagueId ? guestLeagueHref(leagueId) : "/guest"} className="flex items-center gap-2 font-black"><ChartNoAxesCombined size={20} className="text-cyan-300" /> Jimmy GM <span className="rounded bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-200">GUEST</span></Link><div className="flex items-center gap-3 text-sm"><Link href="/guest" className="text-slate-400">Switch league</Link><Link href="/login" className="flex items-center gap-1 font-bold text-cyan-300"><LogIn size={15} /> Log in</Link></div></div>
    </header>
    <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
    {session ? <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-600">Guest data is public Sleeper data plus Jimmy GM&apos;s public analytics. No guest roster or preference records are saved.</footer> : null}
  </div>;
}

function GuestExpired() {
  return <GuestShell><Card className="mx-auto max-w-xl text-center"><h1 className="text-2xl font-black">Guest session ended</h1><p className="mt-2 text-slate-400">Enter your Sleeper username again to reload public league data.</p><Link href="/guest" className="mt-4 inline-block rounded-xl bg-cyan-400 px-4 py-2 font-black text-slate-950">Continue as Guest</Link></Card></GuestShell>;
}

function GuestOverview({ payload, teamId }: { payload: GuestLeaguePayload; teamId: string | null }) {
  const selected = payload.teams.find((team) => team.id === teamId) ?? payload.teams.find((team) => team.isMyTeam) ?? payload.teams[0];
  const projectionLabel = payload.projectionSeason && payload.projectionWeek ? `${payload.projectionSeason} W${payload.projectionWeek}` : null;
  return <div>
    <header><p className="text-xs font-black tracking-[.2em] text-cyan-300">LEAGUE OVERVIEW</p><h1 className="mt-1 text-3xl font-black">{payload.league.name}</h1><p className="mt-2 text-sm text-slate-400">{payload.league.season} · {payload.league.totalRosters} teams · Sleeper league scoring</p></header>
    <TeamSelector items={payload.teams.map((team) => ({ id: team.id, href: `${guestLeagueHref(payload.league.id)}?teamId=${encodeURIComponent(team.id)}`, label: team.isMyTeam ? "My Team" : team.name, detail: team.isMyTeam ? team.name : null, projectedPpg: team.summary?.projectedPpg ?? null, selected: selected?.id === team.id }))} />
    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
      <Card className="p-3 sm:p-4"><div className="flex items-end justify-between"><div><p className="text-[10px] font-black tracking-[.2em] text-cyan-300">{selected?.isMyTeam ? "MY ROSTER" : "LEAGUE ROSTER"}</p><h2 className="mt-1 text-xl font-black">{selected?.name ?? "Roster"}</h2></div><div className="text-right"><b>{selected?.wins ?? 0}-{selected?.losses ?? 0}</b><p className="text-xs font-bold text-cyan-300">{selected?.summary?.projectedPpg?.toFixed(1) ?? "—"} projected PPG</p></div></div>{selected ? <LeagueRoster players={selected.players} projectionLabel={projectionLabel} leagueId={payload.league.id} playerQuery="?scoring=ppr" /> : null}</Card>
      <Card><h2 className="font-black">League format</h2><p className="mt-3 text-sm text-slate-400">{payload.league.rosterPositions.filter((slot) => !["BN", "IR", "TAXI"].includes(slot)).join(" · ") || "Roster slots unavailable"}</p><p className="mt-3 text-sm text-slate-400">Analytics: {payload.analyticsAvailable ? "projection and Player Value available" : "rosters available; analytics temporarily unavailable"}</p></Card>
    </div>
  </div>;
}

function GuestTrades({ payload }: { payload: GuestLeaguePayload }) {
  const teams: TradeTeam[] = payload.teams.map((team) => ({ id: team.id, name: team.isMyTeam ? "My Team" : team.name, isMyTeam: team.isMyTeam, players: team.players.map((player) => ({ id: player.id, teamId: team.id, name: player.full_name, position: player.position, nflTeam: player.team, headshotUrl: player.headshot_url, value: player.player_value, projectedPpg: player.projected_ppg, lastSeasonPpg: player.last_season_ppg, opponent: player.opponent, isHome: player.is_home, teamImpliedTotal: player.team_implied_total, depthRole: player.depth_role })) }));
  return <div><h1 className="text-3xl font-black">Trade Finder</h1><p className="mt-2 text-sm text-slate-400">Uses {payload.league.name}&apos;s scoring, roster demand, and public Sleeper ownership.</p><div className="mt-5"><TradeFinder teams={teams} rosterPositions={payload.league.rosterPositions} analyticsAvailable={payload.analyticsAvailable} leagueTeams={payload.league.totalRosters} /></div></div>;
}

function GuestStartSit({ payload }: { payload: GuestLeaguePayload }) {
  const myTeam = payload.teams.find((team) => team.isMyTeam) ?? payload.teams[0];
  const players: StartSitPlayer[] = (myTeam?.players ?? []).map((player) => ({ id: player.id, name: player.full_name, position: player.position, nflTeam: player.team, headshotUrl: player.headshot_url, projectedPpg: player.projected_ppg, floor: player.projection_floor, ceiling: player.projection_ceiling, confidence: player.confidence as StartSitPlayer["confidence"], depthRole: player.depth_role, opponent: player.opponent, isHome: player.is_home, teamImpliedTotal: player.team_implied_total }));
  return <div><h1 className="text-3xl font-black">Start / Sit</h1><p className="mt-2 text-sm text-slate-400">Compare your guest roster using actual league scoring and legal lineup slots.</p><div className="mt-5"><StartSitComparator players={players} rosterPositions={payload.league.rosterPositions} /></div></div>;
}

function GuestSeason({ payload }: { payload: GuestLeaguePayload }) {
  const inputs = useMemo<SeasonTeamInput[]>(() => payload.teams.map((team) => ({ id: team.id, name: team.name, wins: team.wins, losses: team.losses, ties: team.ties, pointsFor: 0, projectedPpg: Number(team.summary?.projectedPpg ?? 0), projectionSd: 18, rosterValue: team.players.reduce((sum, player) => sum + Math.max(0, Number(player.player_value ?? 0)), 0), allPlayWinPct: null })), [payload]);
  const completedWeeks = Math.max(0, ...inputs.map((team) => team.wins + team.losses + team.ties));
  const regularSeasonWeeks = Math.max(completedWeeks, Number(payload.league.settings.playoff_week_start ?? 15) - 1);
  const schedule = buildFallbackSchedule(inputs.map((team) => team.id), Math.max(0, regularSeasonWeeks - completedWeeks), completedWeeks + 1);
  const playoffTeams = Math.min(inputs.length, Number(payload.league.settings.playoff_teams ?? (inputs.length >= 10 ? 6 : 4)));
  const chances = simulatePlayoffChances({ teams: inputs, schedule, playoffTeams, simulations: 5_000, seed: payload.league.season * 100 + completedWeeks });
  const rankings = calculatePowerRankings(inputs, schedule);
  return <div><h1 className="text-3xl font-black">Season Outlook</h1><p className="mt-2 text-sm text-slate-400">Guest projections use 5,000 deterministic simulations and a balanced fallback schedule when future matchup details are unavailable.</p><Card className="mt-5 overflow-hidden p-0"><div className="divide-y divide-slate-800">{rankings.map((team) => <div key={team.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 p-4"><b className="text-cyan-300">#{team.rank}</b><div><b>{team.name}</b><p className="text-xs text-slate-500">{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ""} · {team.projectedPpg.toFixed(1)} projected PPG · Value {team.rosterValue.toFixed(1)}</p></div><b className="text-cyan-200">{chances.get(team.id)?.toFixed(0) ?? "—"}%</b></div>)}</div></Card></div>;
}
