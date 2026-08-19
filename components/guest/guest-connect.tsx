"use client";

import Link from "next/link";
import { useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  clearGuestSession,
  guestLeagueHref,
  readGuestSession,
  writeGuestSession,
  type GuestLeagueSummary,
} from "@/lib/guest/session";
import { useGuestSession } from "@/lib/guest/use-guest-session";

interface LookupLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters?: number;
}

export function GuestConnect() {
  const saved = useGuestSession();
  const [draftUsername, setDraftUsername] = useState<string | null>(null);
  const [foundLeagues, setFoundLeagues] = useState<GuestLeagueSummary[] | null>(null);
  const username = draftUsername ?? saved?.sleeperUsername ?? "";
  const leagues = foundLeagues ?? saved?.leagues ?? [];
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function findLeagues() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/sleeper/leagues?username=${encodeURIComponent(username.trim())}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not retrieve Sleeper leagues.");
      const found = (result.leagues as LookupLeague[]).map((league) => ({
        leagueId: league.league_id,
        name: league.name,
        season: String(league.season),
        totalRosters: league.total_rosters ?? null,
      }));
      setFoundLeagues(found);
      writeGuestSession({
        mode: "guest",
        sleeperUserId: result.user.user_id,
        sleeperUsername: result.user.username ?? username.trim(),
        selectedLeagueId: found[0]?.leagueId ?? null,
        leagues: found,
      });
      if (!found.length) setMessage("No current NFL leagues were found for that Sleeper account.");
    } catch (error) {
      setFoundLeagues([]);
      setMessage(error instanceof Error ? error.message : "Sleeper is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }

  function forgetGuest() {
    clearGuestSession();
    setDraftUsername("");
    setFoundLeagues([]);
    setMessage("Guest session cleared.");
  }

  return <main className="min-h-screen px-4 py-8 sm:px-6">
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="inline-flex items-center gap-2 text-xs font-black tracking-[0.18em] text-cyan-300">
        <ChartNoAxesCombined size={18} /> JIMMY GM
      </Link>
      <header className="mt-7">
        <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-200">GUEST MODE</span>
        <h1 className="mt-4 text-3xl font-black">Try your Sleeper league</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Enter a public Sleeper username. Your connection stays in this browser session only and is never written to Jimmy GM&apos;s user tables.
        </p>
      </header>
      <Card className="mt-6">
        <label className="text-sm font-bold text-slate-200">Sleeper username
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input
              value={username}
              onChange={(event) => setDraftUsername(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && username.trim() && findLeagues()}
              placeholder="Sleeper username"
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 outline-none focus:border-cyan-400"
            />
            <Button onClick={findLeagues} disabled={loading || !username.trim()}>
              {loading ? "Finding…" : "Find leagues"}
            </Button>
          </div>
        </label>
        {message ? <p role="status" className="mt-3 text-sm text-amber-200">{message}</p> : null}
      </Card>
      {leagues.length ? <Card className="mt-5 p-0">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="font-black">Choose a league</h2>
          <p className="mt-1 text-xs text-slate-500">Public roster data is refreshed from Sleeper when opened.</p>
        </div>
        <div className="divide-y divide-slate-800">
          {leagues.map((league) => <Link
            key={league.leagueId}
            href={guestLeagueHref(league.leagueId)}
            onClick={() => {
              const current = readGuestSession();
              if (current) writeGuestSession({ ...current, selectedLeagueId: league.leagueId });
            }}
            className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-slate-800/50"
          >
            <span><b className="block">{league.name}</b><span className="text-sm text-slate-500">{league.season} · {league.totalRosters ?? "?"} teams</span></span>
            <span className="font-black text-cyan-300">Open →</span>
          </Link>)}
        </div>
      </Card> : null}
      <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
        <Link href="/signup?next=/dashboard/connect" className="font-black text-cyan-300">Create an account to save your league</Link>
        {leagues.length ? <button type="button" onClick={forgetGuest} className="text-slate-500 hover:text-slate-300">Clear guest session</button> : null}
        <Link href="/login" className="text-slate-500 hover:text-slate-300">Log in</Link>
      </div>
    </div>
  </main>;
}
