import { Card } from "../ui/card";
import type { WeeklyProjectionView } from "../../lib/projections/service";

const points = (value: number) => value.toFixed(1);

export function PlayerWeeklyProjections({ rows, currentWeek }: { rows: WeeklyProjectionView[]; currentWeek?: number }) {
  if (!rows.length) return <Card className="mt-6"><h2 className="text-xl font-black">2026 weekly projections</h2><p className="mt-2 text-sm text-slate-400">No weekly projections have been generated for this player yet.</p></Card>;
  const values = rows.map((row) => row.projection.projectedPoints);
  const maximum = Math.max(...values, 1);
  const chartPoints = rows.map((row, index) => {
    const x = rows.length === 1 ? 50 : index / (rows.length - 1) * 100;
    const y = 36 - row.projection.projectedPoints / maximum * 30;
    return `${x},${y}`;
  }).join(" ");
  return <Card className="mt-6 overflow-hidden p-0">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 px-5 py-4">
      <div><h2 className="text-xl font-black">2026 weekly projections</h2><p className="text-sm text-slate-400">Only generated weeks are shown; future weeks are never copied or fabricated.</p></div>
      <svg viewBox="0 0 100 40" role="img" aria-label="Projected points by week" className="h-12 w-36 overflow-visible">
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={chartPoints} className="text-cyan-300" />
        {rows.map((row, index) => <circle key={row.projection.week} cx={rows.length === 1 ? 50 : index / (rows.length - 1) * 100} cy={36 - row.projection.projectedPoints / maximum * 30} r="2.5" className="fill-cyan-300" />)}
      </svg>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-950/80 text-left text-[10px] font-black tracking-wider text-slate-500 uppercase"><tr>{["Week", "Matchup", "Kickoff", "Projected", "Floor", "Median", "Ceiling", "Confidence"].map((label) => <th key={label} className="px-3 py-2.5">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800">{rows.map(({ projection, isHome, kickoff }) => <tr key={projection.week} className={projection.week === currentWeek ? "bg-cyan-400/[0.07]" : ""}>
          <td className="px-3 py-3 font-black text-cyan-200">{projection.week}{projection.week === currentWeek ? <span className="ml-2 text-[9px] text-cyan-400">CURRENT</span> : null}</td>
          <td className="px-3 py-3 font-semibold">{projection.opponent ? `${isHome === false ? "@" : "vs"} ${projection.opponent}` : "—"}</td>
          <td className="px-3 py-3 text-slate-400">{kickoff ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(kickoff)) : "—"}</td>
          <td className="px-3 py-3 font-black text-white">{points(projection.projectedPoints)}</td>
          <td className="px-3 py-3">{points(projection.floor)}</td><td className="px-3 py-3">{points(projection.median)}</td><td className="px-3 py-3">{points(projection.ceiling)}</td>
          <td className="px-3 py-3 capitalize text-slate-400">{projection.confidence}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </Card>;
}
