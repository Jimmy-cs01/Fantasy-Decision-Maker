import { Card } from "../ui/card";
import type { PlayerSeasonRow } from "../../lib/players/types";

export function PlayerHistory({ rows, ppgKey, positionFinishes }: { rows: PlayerSeasonRow[]; ppgKey: keyof PlayerSeasonRow; positionFinishes: Map<number, number> }) {
  if (!rows.length) return null;
  const ppg = (row: PlayerSeasonRow) => Number(row[ppgKey] ?? 0);
  const maximum = Math.max(...rows.map(ppg), 1);
  return <Card className="mt-6">
    <div><h2 className="text-xl font-black">Recent seasons</h2><p className="mt-1 text-sm text-slate-400">Newest first · regular-season production under the selected scoring · final rank uses total fantasy points</p></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{rows.map((row) => <article key={row.season} className="rounded-xl border border-slate-800 bg-slate-950/55 p-3">
      <div className="flex items-center justify-between"><b className="text-lg text-white">{row.season}</b><span className="rounded-md bg-cyan-400/10 px-2 py-1 text-xs font-black text-cyan-300">{positionFinishes.get(row.season) ? `${row.historical_position}${positionFinishes.get(row.season)}` : "—"}</span></div>
      <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-800"><div className="h-full rounded bg-cyan-400" style={{ width: `${Math.max(4, ppg(row) / maximum * 100)}%` }} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><HistoryMetric label="PPG" value={ppg(row).toFixed(1)} /><HistoryMetric label="Games" value={String(row.games_played)} /><HistoryMetric label="Total yards" value={Number(row.total_yards).toLocaleString()} /><HistoryMetric label="Total TD" value={String(row.total_touchdowns)} /><HistoryMetric label="Final position rank" value={positionFinishes.get(row.season) ? `${row.historical_position}${positionFinishes.get(row.season)}` : "—"} /></dl>
    </article>)}</div>
  </Card>;
}

function HistoryMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[9px] font-black tracking-wide text-slate-600 uppercase">{label}</dt><dd className="mt-0.5 font-bold text-slate-200">{value}</dd></div>;
}
