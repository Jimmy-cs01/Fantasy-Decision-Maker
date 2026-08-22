"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PlayerAvatar } from "@/components/players/player-avatar";
import type { WaiverWirePlayer } from "@/lib/waivers/availability";

const FILTERS = ["ALL", "QB", "RB", "WR", "TE"] as const;

export function WaiverWire({
  players,
  playerQuery = "",
}: {
  players: WaiverWirePlayer[];
  playerQuery?: string;
}) {
  const [position, setPosition] = useState<(typeof FILTERS)[number]>("ALL");
  const [limit, setLimit] = useState(100);
  const visible = useMemo(
    () => players.filter((player) => position === "ALL" || player.position === position),
    [players, position],
  );
  const showing = visible.slice(0, limit);
  return <section>
    <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Waiver position filter">
      {FILTERS.map((filter) => <button
        key={filter}
        type="button"
        onClick={() => { setPosition(filter); setLimit(100); }}
        aria-pressed={position === filter}
        className={`min-w-12 rounded-full border px-3 py-2 text-sm font-black ${position === filter ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 text-slate-400"}`}
      >{filter === "ALL" ? "All" : filter}</button>)}
    </div>
    <div className="mt-3 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
      <div className="hidden grid-cols-[minmax(13rem,1.5fr)_6rem_6rem_7rem_7rem] border-b border-slate-800 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500 md:grid">
        <span>Player</span><span>Availability</span><span>Role</span><span>Projected</span><span>Value</span>
      </div>
      <div className="divide-y divide-slate-800">
        {showing.map((player) => <Link
          key={player.id}
          href={`/players/${player.id}${playerQuery}`}
          className="grid gap-3 px-4 py-3 transition hover:bg-slate-800/60 md:grid-cols-[minmax(13rem,1.5fr)_6rem_6rem_7rem_7rem] md:items-center"
        >
          <span className="flex min-w-0 items-center gap-3">
            <PlayerAvatar name={player.full_name} headshotUrl={player.headshot_url} />
            <span className="min-w-0"><b className="block truncate text-slate-100">{player.full_name}</b><span className="text-xs text-slate-500">{player.position} · {player.team ?? "FA"}{player.position_rank ? ` · ${player.position}#${player.position_rank}` : ""}</span></span>
          </span>
          <span className={`w-fit rounded-full px-2 py-1 text-[10px] font-black uppercase ${player.availability === "waiver" ? "bg-amber-400/15 text-amber-200" : "bg-emerald-400/15 text-emerald-200"}`}>{player.availability === "waiver" ? "Waiver" : "Free Agent"}</span>
          <span className="text-sm font-bold text-slate-300">{player.depth_role ?? "—"}</span>
          <span><span className="mr-1 text-[10px] font-black text-slate-600 md:hidden">PPG</span><b className="text-cyan-200">{player.projected_ppg?.toFixed(1) ?? "—"}</b></span>
          <span><span className="mr-1 text-[10px] font-black text-slate-600 md:hidden">VALUE</span><b>{player.player_value?.toFixed(1) ?? "—"}</b></span>
        </Link>)}
        {!visible.length ? <p className="p-6 text-center text-sm text-slate-400">No projected available players match this filter.</p> : null}
      </div>
    </div>
    {showing.length < visible.length ? <button type="button" onClick={() => setLimit((current) => current + 100)} className="mt-3 w-full rounded-xl border border-slate-800 px-4 py-3 text-sm font-black text-cyan-200 hover:bg-slate-900">Show 100 more</button> : null}
    <p className="mt-3 text-xs leading-5 text-slate-500">Availability is resolved from every Sleeper roster in this league. A Waiver label is shown only when Sleeper exposes a pending waiver transaction; otherwise an unrostered player is labeled Free Agent.</p>
  </section>;
}
