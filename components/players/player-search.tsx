"use client";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Result = { id: string; full_name: string; historical_position: string | null; sleeper_position: string | null; team: string | null };

export function PlayerSearch() {
  const router = useRouter(); const [query, setQuery] = useState(""); const [results, setResults] = useState<Result[]>([]); const [active, setActive] = useState(-1); const [loading, setLoading] = useState(false); const requestId = useRef(0);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => { try { const response = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`); const body = await response.json(); if (id === requestId.current) setResults(response.ok ? body.players : []); } finally { if (id === requestId.current) setLoading(false); } }, 180);
    return () => clearTimeout(timer);
  }, [query]);
  function choose(player: Result) { setResults([]); router.push(`/players/${player.id}`); }
  return <div className="relative"><div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3"><Search size={19} className="text-slate-400" /><input aria-label="Search players" aria-autocomplete="list" aria-controls="player-search-results" aria-expanded={query.length >= 2 && !loading} role="combobox" value={query} onChange={(event) => { const next = event.target.value; setQuery(next); setActive(-1); setLoading(next.trim().length >= 2); if (next.trim().length < 2) setResults([]); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, results.length - 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); } else if (event.key === "Enter" && active >= 0) { event.preventDefault(); choose(results[active]); } else if (event.key === "Escape") setResults([]); }} placeholder="Search players by first or last name…" className="w-full bg-transparent outline-none placeholder:text-slate-500" />{loading && <span className="text-xs text-slate-500">Searching…</span>}</div>{query.length >= 2 && !loading && <div id="player-search-results" role="listbox" className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">{results.length ? results.map((player, index) => <button type="button" role="option" aria-selected={active === index} key={player.id} onMouseDown={() => choose(player)} className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-800 ${active === index ? "bg-slate-800" : ""}`}><span className="font-semibold">{player.full_name}</span><span className="text-sm text-slate-400">{player.sleeper_position || player.historical_position || "—"} · {player.team || "FA"}</span></button>) : <p className="px-4 py-3 text-sm text-slate-400">No matching players.</p>}</div>}</div>;
}
