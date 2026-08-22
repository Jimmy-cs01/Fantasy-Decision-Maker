"use client";

import { useMemo, useState } from "react";
import type { HeadToHeadScheduleRow } from "@/lib/leagues/head-to-head";

export function HeadToHeadSchedule({
  rows,
  currentWeek,
  playerNames,
  dstMessage,
}: {
  rows: HeadToHeadScheduleRow[];
  currentWeek: number;
  playerNames: Record<string, string>;
  dstMessage?: string | null;
}) {
  const initial = rows.find((row) => row.week === currentWeek)?.week ?? rows[0]?.week ?? 1;
  const [week, setWeek] = useState(initial);
  const selected = useMemo(() => rows.find((row) => row.week === week) ?? rows[0], [rows, week]);
  if (!selected) return <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400">Sleeper has not published a head-to-head schedule for this league.</p>;
  return <section>
    <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Fantasy matchup week">
      {rows.map((row) => <button key={row.week} type="button" onClick={() => setWeek(row.week)} aria-pressed={row.week === selected.week} className={`min-w-12 rounded-full px-3 py-2 text-sm font-black ${row.week === selected.week ? "bg-cyan-400 text-slate-950" : "bg-slate-900 text-slate-400"}`}>W{row.week}</button>)}
    </div>
    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
        <TeamScore name={selected.teamName} projected={selected.projectedScore} actual={selected.actualScore} winner={selected.projectedWinnerId === selected.teamId} />
        <div><span className="text-xs font-black text-slate-600">VS</span><p className={`mt-1 text-xs font-black ${selected.projectedMargin >= 0 ? "text-emerald-300" : "text-amber-300"}`}>{selected.projectedMargin >= 0 ? "+" : ""}{selected.projectedMargin.toFixed(1)}</p></div>
        <TeamScore name={selected.opponentName} projected={selected.opponentProjectedScore} actual={selected.opponentActualScore} winner={selected.projectedWinnerId === selected.opponentId} />
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">{selected.completed ? "Completed Sleeper result; projections remain available for comparison." : "Projected from each roster's best legal lineup using league scoring. NFL bye players contribute 0."}</p>
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Lineup title={selected.teamName} lineup={selected.lineup} playerNames={playerNames} projectedPpg={selected.lineupPlayerProjectedPpg} />
      <Lineup title={selected.opponentName} lineup={selected.opponentLineup} playerNames={playerNames} projectedPpg={selected.opponentLineupPlayerProjectedPpg} />
    </div>
    {dstMessage ? <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100">DST projection note: {dstMessage}</p> : null}
  </section>;
}

function TeamScore({ name, projected, actual, winner }: { name: string; projected: number; actual: number | null; winner: boolean }) {
  return <div className="min-w-0"><p className="truncate text-sm font-black sm:text-base">{name}</p><p className={`mt-2 text-2xl font-black sm:text-3xl ${winner ? "text-cyan-200" : "text-white"}`}>{projected.toFixed(1)}</p><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Projected</p>{actual != null ? <p className="mt-1 text-xs text-slate-400">Final {actual.toFixed(1)}</p> : null}</div>;
}

function Lineup({ title, lineup, playerNames, projectedPpg }: { title: string; lineup: HeadToHeadScheduleRow["lineup"]; playerNames: Record<string, string>; projectedPpg: Record<string, number> }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><h3 className="truncate font-black">{title} projected starters</h3><div className="mt-3 divide-y divide-slate-800">{lineup?.assignments.map((assignment) => <div key={`${assignment.slotIndex}:${assignment.playerId}`} className="flex justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate"><b className="mr-2 text-cyan-300">{assignment.slot}</b>{playerNames[assignment.playerId] ?? "Unknown player"}</span><span className="shrink-0 font-black text-slate-200">{(projectedPpg[assignment.playerId] ?? 0).toFixed(1)}</span></div>)}{!lineup?.assignments.length ? <p className="py-3 text-sm text-slate-500">No supported projected starters.</p> : null}</div>{lineup && !lineup.complete ? <p className="mt-2 text-xs text-amber-300">Partial lineup: {lineup.filledSlots}/{lineup.requiredSlots} supported slots.</p> : null}</div>;
}
