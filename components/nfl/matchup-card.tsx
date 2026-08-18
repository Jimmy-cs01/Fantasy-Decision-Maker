import { DepthChart } from "./depth-chart";
import type { WeeklyMatchup } from "../../lib/nfl/schedule-service";
import type { DepthChartPlayer } from "../../lib/nfl/depth-chart-service";

const line = (value: number | null) => value == null ? "—" : value.toFixed(1);
const spread = (team: string, value: number | null) => value == null ? "—" : `${team} ${value > 0 ? "+" : ""}${value.toFixed(1)}`;

export function MatchupCard({ game, depthCharts }: { game: WeeklyMatchup; depthCharts: Map<string, DepthChartPlayer[]> }) {
  return <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-black">{game.awayTeam} @ {game.homeTeam}</h2><p className="mt-1 text-sm text-slate-400">{game.kickoff ? new Date(game.kickoff).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "Kickoff TBD"}</p></div>
      <span className="rounded-full bg-slate-950 px-3 py-1 text-xs text-slate-400">{game.booksReporting ? `Consensus · ${game.booksReporting} books${game.latestUpdate ? ` · ${new Date(game.latestUpdate).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : "Odds unavailable"}</span>
    </div>
    <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-800 pt-3 text-sm">
      <div><dt className="text-[10px] uppercase text-slate-500">Spread</dt><dd className="mt-1 font-bold">{spread(game.homeTeam, game.homeSpread)}</dd></div>
      <div><dt className="text-[10px] uppercase text-slate-500">Total</dt><dd className="mt-1 font-bold">{line(game.gameTotal)}</dd></div>
      <div><dt className="text-[10px] uppercase text-slate-500">Implied</dt><dd className="mt-1 font-bold">{game.awayTeam} {line(game.awayImpliedTotal)} · {game.homeTeam} {line(game.homeImpliedTotal)}</dd></div>
    </dl>
    <details className="mt-3 border-t border-slate-800 pt-3">
      <summary className="cursor-pointer text-sm font-bold text-cyan-300">Compare fantasy depth charts</summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-2"><DepthChart compact team={game.awayTeam} players={depthCharts.get(game.awayTeam) ?? []} /><DepthChart compact team={game.homeTeam} players={depthCharts.get(game.homeTeam) ?? []} /></div>
    </details>
  </article>;
}
