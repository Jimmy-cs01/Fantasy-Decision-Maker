import type { ReactNode } from "react";
import type { LeagueAnalyticsPlayer, TeamProjectionSummary } from "@/lib/player-values/league-service";
import { Card } from "@/components/ui/card";
import { LeagueRoster } from "./league-roster";
import { TeamSelector } from "./team-selector";
import { RosterInjurySummary } from "@/components/injuries/roster-injury-summary";

export interface LeagueOverviewTeam {
  id: string;
  displayName: string;
  ownerName?: string | null;
  wins: number;
  losses: number;
  ties: number;
  isMyTeam: boolean;
  players: LeagueAnalyticsPlayer[];
  summary: TeamProjectionSummary | null;
}

export function LeagueOverview({
  league,
  teams,
  selectedTeamId,
  teamHref,
  projectionLabel,
  headerAction,
  playerQuery,
  rosterLoadFailed = false,
}: {
  league: {
    id: string;
    name: string;
    season: number | string;
    seasonType?: string | null;
    totalRosters: number;
    provider?: string | null;
    rosterPositions: string[];
    scoringAvailable: boolean;
    lastSyncedAt?: string | null;
    ephemeral?: boolean;
  };
  teams: LeagueOverviewTeam[];
  selectedTeamId?: string | null;
  teamHref: (teamId: string) => string;
  projectionLabel: string | null;
  headerAction?: ReactNode;
  playerQuery?: string;
  rosterLoadFailed?: boolean;
}) {
  const selectedTeam = teams.find((team) => team.id === selectedTeamId)
    ?? teams.find((team) => team.isMyTeam)
    ?? teams[0]
    ?? null;
  const players = selectedTeam?.players ?? [];
  const selectedTeamProjection = selectedTeam?.summary ?? null;
  const positionCounts = players.reduce<Record<string, number>>((counts, player) => {
    const key = player.position || "Other";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const providerName = league.provider === "yahoo" ? "Yahoo" : "Sleeper";

  return <div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-black tracking-[0.2em] text-cyan-300">LEAGUE OVERVIEW</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">{league.name}</h1>
        <p className="mt-1.5 text-sm text-slate-400">{league.season} · {league.seasonType ?? "regular"} · {league.totalRosters} teams{league.provider ? ` · ${providerName}` : ""}</p>
      </div>
      {headerAction}
    </div>
    <p className="mt-3 text-xs text-slate-500">Last synchronization: {league.lastSyncedAt ? new Date(league.lastSyncedAt).toLocaleString() : league.ephemeral ? "Current browser session" : "Not yet synced"}</p>

    <TeamSelector items={teams.map((team) => ({
      id: team.id,
      href: teamHref(team.id),
      label: team.isMyTeam ? "My Team" : team.displayName,
      detail: team.isMyTeam && team.displayName !== "My Team" ? team.displayName : null,
      projectedPpg: team.summary?.projectedPpg ?? null,
      selected: selectedTeam?.id === team.id,
    }))} />

    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
      <Card className="p-3 sm:p-4">
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">{selectedTeam?.isMyTeam ? "My roster" : selectedTeam?.ownerName || "League roster"}</p>
            <h2 className="mt-1 truncate text-lg font-bold sm:text-xl">{selectedTeam?.displayName ?? "Roster unavailable"}</h2>
          </div>
          {selectedTeam ? <div className="shrink-0 text-right">
            <p className="text-sm font-black text-slate-300">{selectedTeam.wins}-{selectedTeam.losses}{selectedTeam.ties ? `-${selectedTeam.ties}` : ""}</p>
            {selectedTeamProjection?.projectedPpg != null ? <p className="mt-1 text-xs font-bold text-cyan-300">{selectedTeamProjection.projectedPpg.toFixed(1)} projected PPG{selectedTeamProjection.complete ? "" : " · partial"}</p> : null}
          </div> : null}
        </div>
        {players.length ? <LeagueRoster players={players} projectionLabel={projectionLabel} leagueId={league.id} playerQuery={playerQuery} /> : <p className="mt-4 rounded-lg border border-dashed border-slate-700 p-5 text-sm text-slate-400">{rosterLoadFailed ? "Roster data is temporarily unavailable. Your league connection is still available; please retry this page." : `No player data was returned for this roster. Some ${providerName} identities may still need canonical mapping.`}</p>}
      </Card>
      <div className="space-y-5">
        <RosterInjurySummary players={players} playerQuery={playerQuery ?? `?scoring=league&leagueId=${league.id}`} />
        <Card>
          <h2 className="font-bold">League format</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <OverviewMetric label="Scoring" value={league.scoringAvailable ? `${providerName} league scoring` : "PPR fallback"} />
            <OverviewMetric label="Projection" value={projectionLabel ?? "Unavailable"} />
            <OverviewMetric label="Optimal lineup" value={selectedTeamProjection ? `${selectedTeamProjection.filledSlots}/${selectedTeamProjection.requiredSlots} slots` : "Unavailable"} />
            <OverviewMetric label="Starter slots" value={league.rosterPositions.filter((slot) => !["BN", "IR", "TAXI"].includes(slot)).join(" · ") || "—"} />
          </dl>
        </Card>
        <Card>
          <h2 className="font-bold">Positional breakdown</h2>
          <div className="mt-3 flex flex-wrap gap-2">{Object.entries(positionCounts).length ? Object.entries(positionCounts).map(([position, count]) => <span key={position} className="rounded bg-slate-800 px-3 py-1 text-sm">{position} <b className="text-cyan-300">{count}</b></span>) : <p className="text-sm text-slate-400">Roster unavailable</p>}</div>
        </Card>
      </div>
    </div>
  </div>;
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-slate-400">{label}</dt><dd className="text-right">{value}</dd></div>;
}
