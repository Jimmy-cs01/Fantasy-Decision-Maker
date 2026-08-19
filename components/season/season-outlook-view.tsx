import type { calculatePowerRankings } from "@/lib/season/outlook";
import { Card } from "@/components/ui/card";

type PowerRanking = ReturnType<typeof calculatePowerRankings>[number];

export function SeasonOutlookView({
  leagueName,
  playoffTeams,
  scheduleSource,
  simulationCount,
  rankings,
  playoffChances,
  leagueNavigation,
}: {
  leagueName: string;
  playoffTeams: number;
  scheduleSource: string;
  simulationCount: number;
  rankings: PowerRanking[];
  playoffChances: Map<string, number>;
  leagueNavigation?: React.ReactNode;
}) {
  return <div className="mx-auto max-w-7xl">
    <header>
      <p className="text-xs font-black tracking-[.2em] text-cyan-300">LEAGUE ANALYTICS</p>
      <h1 className="mt-1 text-3xl font-black">Jimmy GM Season Outlook</h1>
      <p className="mt-2 text-sm text-slate-400">Results, optimized lineup strength, roster value, remaining schedule, and {simulationCount.toLocaleString()} seeded playoff simulations.</p>
    </header>
    {leagueNavigation}
    <Card className="mt-5 overflow-hidden p-0">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="font-black">Season Rankings &amp; Playoff Chances</h2>
        <p className="mt-1 text-xs text-slate-500">{leagueName} · {playoffTeams} playoff teams · schedule: {scheduleSource}</p>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[850px] text-sm">
          <thead className="bg-slate-950/80 text-left text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Rank</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Record</th><th className="px-4 py-3">Points For</th><th className="px-4 py-3">Starting PPG</th><th className="px-4 py-3">Roster Value</th><th className="px-4 py-3">Playoff Chance</th></tr></thead>
          <tbody className="divide-y divide-slate-800">{rankings.map((team) => <tr key={team.id}><td className="px-4 py-3 font-black text-cyan-300">{team.rank}</td><td className="px-4 py-3"><b>{team.name}</b><p className="text-xs text-slate-500">Power {team.powerScore.toFixed(1)}</p></td><td className="px-4 py-3">{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ""}</td><td className="px-4 py-3 tabular-nums">{team.pointsFor ? team.pointsFor.toFixed(1) : "—"}</td><td className="px-4 py-3 tabular-nums">{team.projectedPpg.toFixed(1)}</td><td className="px-4 py-3 tabular-nums">{team.rosterValue.toFixed(1)}</td><td className="px-4 py-3 font-black tabular-nums text-cyan-200">{playoffChances.get(team.id)?.toFixed(1) ?? "—"}%</td></tr>)}</tbody>
        </table>
      </div>
      <div className="divide-y divide-slate-800 md:hidden">{rankings.map((team) => <article key={team.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><span className="mr-2 font-black text-cyan-300">#{team.rank}</span><b>{team.name}</b><p className="mt-1 text-xs text-slate-500">{team.wins}-{team.losses}{team.ties ? `-${team.ties}` : ""} · Power {team.powerScore.toFixed(1)}</p></div><div className="text-right"><b className="text-xl text-cyan-200">{playoffChances.get(team.id)?.toFixed(0) ?? "—"}%</b><p className="text-[9px] text-slate-500">PLAYOFFS</p></div></div><dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><Metric label="Proj PPG" value={team.projectedPpg.toFixed(1)} /><Metric label="Roster value" value={team.rosterValue.toFixed(1)} /><Metric label="Points for" value={team.pointsFor ? team.pointsFor.toFixed(1) : "—"} /></dl></article>)}</div>
    </Card>
    <p className="mt-4 text-xs text-slate-500">Power score weights: 35% current performance, 30% optimized lineup projection, 20% roster value, 15% remaining schedule. Simulations use projected lineup uncertainty and qualify teams by wins, ties, then points. Divisions and provider-specific tiebreakers are not modeled; when a future schedule is unavailable, the displayed balanced fallback is used.</p>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[9px] font-black uppercase text-slate-600">{label}</dt><dd className="mt-0.5 font-bold">{value}</dd></div>;
}
