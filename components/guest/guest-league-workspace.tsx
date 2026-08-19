"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { LeagueOverview } from "@/components/dashboard/league-overview";
import { SeasonOutlookView } from "@/components/season/season-outlook-view";
import { StartSitComparator } from "@/components/start-sit/start-sit-comparator";
import { TradeFinder, type TradeTeam } from "@/components/trades/trade-finder";
import { Card } from "@/components/ui/card";
import {
  guestLeagueHref,
  readGuestSession,
  writeGuestSession,
} from "@/lib/guest/session";
import { useGuestSession } from "@/lib/guest/use-guest-session";
import {
  buildFallbackSchedule,
  calculatePowerRankings,
  simulatePlayoffChances,
  type SeasonTeamInput,
} from "@/lib/season/outlook";
import type { StartSitPlayer } from "@/lib/start-sit/service";
import type {
  LeagueAnalyticsPlayer,
  TeamProjectionSummary,
} from "@/lib/player-values/league-service";

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

const GUEST_VIEWS = new Set(["overview", "trades", "start-sit", "season"]);

export function GuestLeagueWorkspace({ leagueId }: { leagueId: string }) {
  const query = useSearchParams();
  const requestedView = query.get("view");
  const view =
    requestedView && GUEST_VIEWS.has(requestedView)
      ? requestedView
      : "overview";
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
    fetch(
      `/api/guest/sleeper/league/${encodeURIComponent(leagueId)}?username=${encodeURIComponent(current.sleeperUsername)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error ?? "Unable to load guest league.");
        setResult({ leagueId, payload: result, error: "" });
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setResult({
          leagueId,
          payload: null,
          error:
            cause instanceof Error
              ? cause.message
              : "Unable to load guest league.",
        });
      });
    return () => controller.abort();
  }, [leagueId]);

  if (session === null)
    return (
      <AppShell guest guestView={view}>
        <GuestExpired />
      </AppShell>
    );
  if (!result || result.leagueId !== leagueId)
    return (
      <AppShell guest guestView={view}>
        <p className="mx-auto max-w-6xl rounded-xl border border-slate-800 p-6 text-slate-400">
          Loading public Sleeper league data…
        </p>
      </AppShell>
    );
  if (result.error || !result.payload)
    return (
      <AppShell guest guestView={view}>
        <Card className="mx-auto max-w-6xl text-center">
          <h1 className="text-xl font-black">Guest league unavailable</h1>
          <p className="mt-2 text-slate-400">
            {result.error || "The guest session could not load this league."}
          </p>
          <Link
            href="/guest"
            className="mt-4 inline-block font-black text-cyan-300"
          >
            Choose another league →
          </Link>
        </Card>
      </AppShell>
    );
  const payload = result.payload;

  return (
    <AppShell guest guestView={view}>
      {view === "overview" ? (
        <GuestOverview payload={payload} teamId={query.get("teamId")} />
      ) : null}
    {view === "trades" ? <GuestTrades payload={payload} /> : null}
    {view === "start-sit" ? <GuestStartSit payload={payload} /> : null}
    {view === "season" ? <GuestSeason payload={payload} /> : null}
    </AppShell>
  );
}

function GuestExpired() {
  return (
    <Card className="mx-auto max-w-xl text-center">
      <h1 className="text-2xl font-black">Guest session ended</h1>
      <p className="mt-2 text-slate-400">
        Enter your Sleeper username again to reload public league data.
      </p>
      <Link
        href="/guest"
        className="mt-4 inline-block rounded-xl bg-cyan-400 px-4 py-2 font-black text-slate-950"
      >
        Continue as Guest
      </Link>
    </Card>
  );
}

function GuestOverview({
  payload,
  teamId,
}: {
  payload: GuestLeaguePayload;
  teamId: string | null;
}) {
  const projectionLabel =
    payload.projectionSeason && payload.projectionWeek
      ? `${payload.projectionSeason} W${payload.projectionWeek}`
      : null;
  return (
    <LeagueOverview
    league={{
        id: payload.league.id,
        name: payload.league.name,
        season: payload.league.season,
        seasonType: payload.league.seasonType,
        totalRosters: payload.league.totalRosters,
        provider: "sleeper",
        rosterPositions: payload.league.rosterPositions,
        scoringAvailable:
          Object.keys(payload.league.scoringSettings).length > 0,
      ephemeral: true,
    }}
    teams={payload.teams.map((team) => ({
        id: team.id,
        displayName: team.name,
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        isMyTeam: team.isMyTeam,
        players: team.players,
        summary: team.summary,
    }))}
    selectedTeamId={teamId}
      teamHref={(id) =>
        `${guestLeagueHref(payload.league.id)}?teamId=${encodeURIComponent(id)}`
      }
    projectionLabel={projectionLabel}
    playerQuery="?scoring=ppr"
    />
  );
}

function GuestTrades({ payload }: { payload: GuestLeaguePayload }) {
  const teams: TradeTeam[] = payload.teams.map((team) => ({
    id: team.id,
    name: team.isMyTeam ? "My Team" : team.name,
    isMyTeam: team.isMyTeam,
    players: team.players.map((player) => ({
      id: player.id,
      teamId: team.id,
      name: player.full_name,
      position: player.position,
      nflTeam: player.team,
      headshotUrl: player.headshot_url,
      value: player.player_value,
      projectedPpg: player.projected_ppg,
      lastSeasonPpg: player.last_season_ppg,
      opponent: player.opponent,
      isHome: player.is_home,
      teamImpliedTotal: player.team_implied_total,
      depthRole: player.depth_role,
    })),
  }));
  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="text-3xl font-black">Trade Finder</h1>
      <p className="mt-2 text-sm text-slate-400">
        Uses {payload.league.name}&apos;s scoring, roster demand, and public
        Sleeper ownership.
      </p>
      <div className="mt-5">
        <TradeFinder
          teams={teams}
          rosterPositions={payload.league.rosterPositions}
          analyticsAvailable={payload.analyticsAvailable}
          leagueTeams={payload.league.totalRosters}
          projectionLabel={
            payload.projectionSeason && payload.projectionWeek
              ? `${payload.projectionSeason} W${payload.projectionWeek}`
              : null
          }
        />
      </div>
    </div>
  );
}

function GuestStartSit({ payload }: { payload: GuestLeaguePayload }) {
  const myTeam =
    payload.teams.find((team) => team.isMyTeam) ?? payload.teams[0];
  const players: StartSitPlayer[] = (myTeam?.players ?? []).map((player) => ({
    id: player.id,
    name: player.full_name,
    position: player.position,
    nflTeam: player.team,
    headshotUrl: player.headshot_url,
    projectedPpg: player.projected_ppg,
    floor: player.projection_floor,
    ceiling: player.projection_ceiling,
    confidence: player.confidence as StartSitPlayer["confidence"],
    depthRole: player.depth_role,
    opponent: player.opponent,
    isHome: player.is_home,
    teamImpliedTotal: player.team_implied_total,
  }));
  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="text-3xl font-black">Start / Sit</h1>
      <p className="mt-2 text-sm text-slate-400">
        Compare your roster using actual league scoring and legal lineup slots.
      </p>
      <div className="mt-5">
        <StartSitComparator
          players={players}
          rosterPositions={payload.league.rosterPositions}
        />
      </div>
    </div>
  );
}

function GuestSeason({ payload }: { payload: GuestLeaguePayload }) {
  const inputs = useMemo<SeasonTeamInput[]>(
    () =>
      payload.teams.map((team) => ({
        id: team.id,
        name: team.name,
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        pointsFor: 0,
        projectedPpg: Number(team.summary?.projectedPpg ?? 0),
        projectionSd: 18,
        rosterValue: team.players.reduce(
          (sum, player) => sum + Math.max(0, Number(player.player_value ?? 0)),
          0,
        ),
        allPlayWinPct: null,
      })),
    [payload],
  );
  const completedWeeks = Math.max(
    0,
    ...inputs.map((team) => team.wins + team.losses + team.ties),
  );
  const regularSeasonWeeks = Math.max(
    completedWeeks,
    Number(payload.league.settings.playoff_week_start ?? 15) - 1,
  );
  const schedule = buildFallbackSchedule(
    inputs.map((team) => team.id),
    Math.max(0, regularSeasonWeeks - completedWeeks),
    completedWeeks + 1,
  );
  const playoffTeams = Math.min(
    inputs.length,
    Number(
      payload.league.settings.playoff_teams ?? (inputs.length >= 10 ? 6 : 4),
    ),
  );
  const chances = simulatePlayoffChances({
    teams: inputs,
    schedule,
    playoffTeams,
    simulations: 5_000,
    seed: payload.league.season * 100 + completedWeeks,
  });
  const rankings = calculatePowerRankings(inputs, schedule);
  return (
    <SeasonOutlookView
    leagueName={payload.league.name}
    playoffTeams={playoffTeams}
    scheduleSource="balanced round-robin fallback"
    simulationCount={5_000}
    rankings={rankings}
    playoffChances={chances}
    />
  );
}
