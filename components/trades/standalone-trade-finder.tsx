"use client";

import { Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { PlayerAvatar } from "../players/player-avatar";
import { useManualRoster } from "@/lib/manual-roster/use-manual-roster";
import type { TradePlayer } from "@/lib/trades/engine";
import { TradeFinder, type TradeTeam } from "./trade-finder";

export function StandaloneTradeFinder({ players, rosterPositions }: { players: TradePlayer[]; rosterPositions: string[] }) {
  const { state, update } = useManualRoster();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return players.filter((player) => !search || player.name.toLowerCase().includes(search) || player.position?.toLowerCase().includes(search) || player.nflTeam?.toLowerCase().includes(search)).slice(0, 30);
  }, [players, query]);
  const teams: TradeTeam[] = [
    { id: "manual-my-team", name: "My Manual Roster", isMyTeam: true, players: players.filter((player) => state.myPlayerIds.includes(player.id)).map((player) => ({ ...player, teamId: "manual-my-team" })) },
    { id: "manual-partner", name: "Trade Partner", isMyTeam: false, players: players.filter((player) => state.partnerPlayerIds.includes(player.id)).map((player) => ({ ...player, teamId: "manual-partner" })) },
  ];
  const toggle = (side: "myPlayerIds" | "partnerPlayerIds", id: string) => update({
    ...state,
    [side]: state[side].includes(id) ? state[side].filter((item) => item !== id) : [...state[side], id],
  });

  return <div>
    <section className="mb-5 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black">Build two temporary rosters</h2><p className="mt-1 text-sm text-slate-400">No fantasy platform required. Rosters stay in this browser session and use Jimmy GM default PPR settings.</p></div><div className="text-xs font-bold text-slate-400">My roster {state.myPlayerIds.length} · Partner {state.partnerPlayerIds.length}</div></div>
      <label className="mt-3 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5"><Search size={17} className="text-slate-500" /><span className="sr-only">Search players for manual rosters</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, position, or NFL team" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      <div className="mt-3 max-h-72 divide-y divide-slate-800 overflow-y-auto">{visible.map((player) => {
        const mine = state.myPlayerIds.includes(player.id); const theirs = state.partnerPlayerIds.includes(player.id);
        return <div key={player.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 py-2"><PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} /><div className="min-w-0"><p className="truncate font-bold">{player.name}</p><p className="text-xs text-slate-500">{player.position} · {player.nflTeam ?? "FA"} · {player.projectedPpg?.toFixed(1)} PPG · Value {player.value?.toFixed(1)}</p></div><div className="flex gap-1"><RosterButton active={mine} label={`${mine ? "Remove" : "Add"} ${player.name} ${mine ? "from" : "to"} my roster`} onClick={() => toggle("myPlayerIds", player.id)}>Mine</RosterButton><RosterButton active={theirs} label={`${theirs ? "Remove" : "Add"} ${player.name} ${theirs ? "from" : "to"} partner roster`} onClick={() => toggle("partnerPlayerIds", player.id)}>Partner</RosterButton></div></div>;
      })}</div>
    </section>
    <TradeFinder teams={teams} rosterPositions={rosterPositions} analyticsAvailable={teams.every((team) => team.players.length > 0)} leagueTeams={10} projectionLabel="Jimmy GM default PPR" />
  </div>;
}

function RosterButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold ${active ? "border-cyan-400 bg-cyan-400/10 text-cyan-200" : "border-slate-700 text-slate-300"}`}>{active ? <X size={12} /> : <Plus size={12} />}{children}</button>;
}
