"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { importLeague, importYahooLeague } from "../actions";

type SleeperLeague = { league_id: string; name: string; season: string; total_rosters?: number };
type YahooLeague = { externalId: string; name: string; season: number; totalTeams: number | null };

export function ConnectForm({ initialSleeperUsername = "", preferredLeagueId = null }: { initialSleeperUsername?: string; preferredLeagueId?: string | null }) {
  const [username, setUsername] = useState(initialSleeperUsername);
  const [sleeperLeagues, setSleeperLeagues] = useState<SleeperLeague[]>([]);
  const [yahooLeagues, setYahooLeagues] = useState<YahooLeague[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function findSleeperLeagues(lookupUsername = username) {
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/sleeper/leagues?username=${encodeURIComponent(lookupUsername)}`);
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSleeperLeagues(data.leagues);
      if (!data.leagues.length) setMessage("No NFL leagues were found for the current season.");
    } catch (error) { setSleeperLeagues([]); setMessage(error instanceof Error ? error.message : "Could not retrieve leagues."); }
    finally { setLoading(false); }
  }

  async function loadYahooLeagues() {
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/yahoo/leagues"); const data = await response.json();
      if (!response.ok) throw new Error(data.error); setYahooLeagues(data.leagues);
      if (!data.leagues.length) setMessage("No Yahoo fantasy football leagues were found.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not retrieve Yahoo leagues."); }
    finally { setLoading(false); }
  }

  return <div className="max-w-2xl">
    <h1 className="mb-5 text-3xl font-black">Connect a league</h1>
    <div className="grid gap-5">
      <Card><p className="text-sm font-bold tracking-widest text-cyan-300">SLEEPER</p><p className="mt-2 text-slate-300">Use your public Sleeper username to find this season&apos;s NFL leagues.</p><div className="mt-5 flex gap-3"><input value={username} onChange={(event) => setUsername(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void findSleeperLeagues()} placeholder="Sleeper username" className="min-w-0 flex-1 rounded-lg border bg-slate-950 px-3 py-2" /><Button onClick={() => void findSleeperLeagues()} disabled={loading || !username}>{loading ? "Finding…" : "Find leagues"}</Button></div></Card>
      <Card><p className="text-sm font-bold tracking-widest text-purple-300">YAHOO</p><p className="mt-2 text-slate-300">Authorize read-only access, then choose a Yahoo fantasy football league to import.</p><div className="mt-5 flex flex-wrap gap-3"><a href="/api/yahoo/connect"><Button>Connect Yahoo</Button></a><Button className="bg-slate-700 text-white hover:bg-slate-600" onClick={loadYahooLeagues} disabled={loading}>{loading ? "Loading…" : "Load connected leagues"}</Button></div></Card>
    </div>
    {message && <p className="mt-4 rounded bg-slate-800 p-3 text-sm text-slate-300">{message}</p>}
    {sleeperLeagues.length > 0 && <Card className="mt-6"><h2 className="text-xl font-bold">Your Sleeper leagues</h2>{preferredLeagueId ? <p className="mt-1 text-sm text-cyan-200">Your guest league is ready to save.</p> : null}<div className="mt-4 divide-y divide-slate-800">{sleeperLeagues.map((league) => <form key={league.league_id} action={importLeague} className={`flex items-center gap-4 py-4 ${league.league_id === preferredLeagueId ? "rounded-lg bg-cyan-400/5 px-2" : ""}`}><input type="hidden" name="username" value={username} /><input type="hidden" name="leagueId" value={league.league_id} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{league.name}</p><p className="text-sm text-slate-400">{league.season} · {league.total_rosters ?? "?"} teams</p></div><Button>{league.league_id === preferredLeagueId ? "Save league" : "Import"}</Button></form>)}</div></Card>}
    {yahooLeagues.length > 0 && <Card className="mt-6"><h2 className="text-xl font-bold">Your Yahoo leagues</h2><div className="mt-4 divide-y divide-slate-800">{yahooLeagues.map((league) => <form key={league.externalId} action={importYahooLeague} className="flex items-center gap-4 py-4"><input type="hidden" name="leagueId" value={league.externalId} /><div className="min-w-0 flex-1"><p className="truncate font-semibold">{league.name}</p><p className="text-sm text-slate-400">{league.season} · {league.totalTeams ?? "?"} teams</p></div><Button>Import</Button></form>)}</div></Card>}
  </div>;
}
