"use client";

import { useMemo, useState } from "react";
import { PlayerAvatar } from "../players/player-avatar";
import { PlayerLink } from "../players/player-link";
import { isEligibleForLineupSlot, recommendStarts } from "../../lib/start-sit/decision";
import type { StartSitPlayer } from "../../lib/start-sit/service";

const normalizeSlot = (slot: string) => slot.trim().toUpperCase().replaceAll(" ", "_");
const DECISION_SLOTS = new Set(["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "SUPERFLEX", "OP", "REC_FLEX", "WR_TE_FLEX"]);

export function StartSitComparator({ players, rosterPositions = [] }: { players: StartSitPlayer[]; rosterPositions?: string[] }) {
  const slots = [...new Set(rosterPositions.map(normalizeSlot).filter((slot) => DECISION_SLOTS.has(slot)))];
  const [slot, setSlot] = useState(slots[0] ?? "ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const starters = slot === "ALL" ? 1 : Math.max(1, rosterPositions.filter((item) => normalizeSlot(item) === slot).length);
  const selected = players.filter((player) => selectedIds.includes(player.id));
  const recommendations = useMemo(() => recommendStarts(selected, { slot, starters }), [selected, slot, starters]);
  const visible = players.filter((player) => {
    const search = query.trim().toLowerCase();
    const matchesSlot = slot === "ALL" || isEligibleForLineupSlot(player.position, slot);
    return matchesSlot && (!search || player.name.toLowerCase().includes(search) || player.position?.toLowerCase().includes(search) || player.nflTeam?.toLowerCase().includes(search));
  }).slice(0, 40);
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 6 ? [...current, id] : current);

  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,.72fr)]">
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-black">Choose players</h2><p className="text-xs text-slate-400">Select 2–6 players from the loaded roster or projection pool.</p></div>
        <label className="text-[10px] font-black tracking-wider text-slate-400 uppercase">Lineup slot<select value={slot} onChange={(event) => { setSlot(event.target.value); setSelectedIds([]); }} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="ALL">Any position</option>{slots.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select></label>
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter comparison players" placeholder="Search name, position, or NFL team" className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-cyan-400" />
      <div className="mt-3 max-h-[34rem] space-y-1 overflow-y-auto pr-1">{visible.map((player) => {
        const active = selectedIds.includes(player.id);
        return <button key={player.id} type="button" aria-pressed={active} onClick={() => toggle(player.id)} className={`grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-2 py-2 text-left transition ${active ? "border-cyan-400/70 bg-cyan-400/10" : "border-transparent bg-slate-950/45 hover:border-slate-700"}`}>
          <PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} />
          <span className="min-w-0"><span className="block truncate font-bold">{player.name}</span><span className="block text-xs text-slate-500">{player.position ?? "—"} · {player.nflTeam ?? "FA"}{player.depthRole ? ` · ${player.depthRole}` : ""}</span></span>
          <span className="text-right"><b className="block tabular-nums text-cyan-200">{player.projectedPpg?.toFixed(1) ?? "—"}</b><small className="text-[9px] text-slate-500">PROJECTED</small></span>
        </button>;
      })}</div>
    </section>
    <section aria-live="polite" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 lg:sticky lg:top-5 lg:self-start">
      <p className="text-xs font-black tracking-[.18em] text-cyan-300">RECOMMENDATION</p>
      {recommendations.length >= 2 ? <>
        <h2 className="mt-1 text-xl font-black">Start {recommendations.filter((row) => row.recommended).map((row) => row.name).join(", ")}</h2>
        <p className="mt-1 text-xs text-slate-400">Final projection is primary; floor and confidence are bounded secondary context. Vegas is not counted twice.</p>
        <ol className="mt-4 space-y-2">{recommendations.map((player) => <li key={player.id} className={`rounded-xl border p-3 ${player.recommended ? "border-cyan-400/50 bg-cyan-400/10" : "border-slate-800 bg-slate-950/45"}`}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="mr-2 text-sm font-black text-cyan-300">{player.rank}</span><PlayerLink playerId={player.id} className="font-black">{player.name}</PlayerLink><p className="mt-1 text-xs text-slate-500">{player.isHome === false ? "@" : "vs"} {player.opponent ?? "opponent —"} · {player.depthRole ?? "role —"}</p></div><div className="text-right"><b className="text-xl tabular-nums">{player.projectedPpg?.toFixed(1) ?? "—"}</b><p className="text-[9px] text-slate-500">JIMMY GM</p></div></div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs"><Metric label="Floor" value={player.floor?.toFixed(1) ?? "—"} /><Metric label="Ceiling" value={player.ceiling?.toFixed(1) ?? "—"} /><Metric label="Confidence" value={player.confidence ?? "—"} /></dl>
          {[...player.reasons, ...player.warnings].length ? <ul className="mt-2 space-y-0.5 text-xs text-slate-400">{player.reasons.map((reason) => <li key={reason}>• {reason}</li>)}{player.warnings.map((warning) => <li key={warning} className="text-amber-300/80">• {warning}</li>)}</ul> : null}
        </li>)}</ol>
      </> : <div className="py-12 text-center"><h2 className="font-bold">Select at least two players</h2><p className="mt-2 text-sm text-slate-400">The comparison and recommendation will appear here.</p></div>}
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[9px] font-black tracking-wide text-slate-600 uppercase">{label}</dt><dd className="mt-0.5 truncate font-bold capitalize text-slate-200">{value}</dd></div>;
}
