import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlayerLeaderboard } from "@/components/players/player-leaderboard";
import { PlayerSearch } from "@/components/players/player-search";
import { POSITIONS, parsePlayerFilters, positionColumns } from "@/lib/players/filters";
import { getAvailableSeasons, getPlayerLeaders } from "@/lib/players/queries";

const first = (input: string | string[] | undefined) => Array.isArray(input) ? input[0] : input;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filters = parsePlayerFilters(params);
  let seasons: number[] = [];
  let error = "";
  try {
    seasons = await getAvailableSeasons(filters.seasonType);
  } catch (cause) {
    console.error(cause);
    error = "Historical statistics are unavailable. Apply the latest player-stat migration and verify the nflverse import.";
  }
  const requestedSeason = Number.parseInt(first(params.season) ?? "", 10);
  const season = seasons.includes(requestedSeason) ? requestedSeason : seasons[0];
  let result = { rows: [], total: 0, pageSize: 50 } as Awaited<ReturnType<typeof getPlayerLeaders>>;
  if (season && !error) {
    try {
      result = await getPlayerLeaders({ season, ...filters });
    } catch (cause) {
      console.error(cause);
      error = "The leaderboard query failed. Apply the latest nflverse migration before using the stat explorer.";
    }
  }
  const columns = positionColumns(filters.position, filters.scoring);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const href = (changes: Record<string, string | number>) => {
    const query = new URLSearchParams({
      season: String(season ?? ""), scoring: filters.scoring, position: filters.position,
      seasonType: filters.seasonType, sort: filters.sort, view: filters.view,
      page: String(filters.page),
      ...Object.fromEntries(Object.entries(changes).map(([key, item]) => [key, String(item)])),
    });
    return `/players?${query}`;
  };

  return <div className="mx-auto max-w-7xl">
    <header>
      <p className="text-xs font-black tracking-[0.22em] text-cyan-300">PLAYER EXPLORER</p>
      <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">NFL & Fantasy Leaders</h1>
      <p className="mt-1 text-sm text-slate-400">Dense, position-aware nflverse season statistics.</p>
    </header>

    <div className="mt-4"><PlayerSearch /></div>

    <section className="mt-5" aria-labelledby="leaders-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 id="leaders-heading" className="text-xl font-black sm:text-2xl">Leaders</h2>
          <nav aria-label="Leaderboard view" className="flex rounded-lg bg-slate-900 p-1 text-xs font-bold">
            <Link href={href({ view: "leaders", page: 1 })} aria-current={filters.view === "leaders" ? "page" : undefined} className={`rounded-md px-2.5 py-1.5 ${filters.view === "leaders" ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:text-white"}`}>Ranked</Link>
            <Link href={href({ view: "all", page: 1 })} aria-current={filters.view === "all" ? "page" : undefined} className={`rounded-md px-2.5 py-1.5 ${filters.view === "all" ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:text-white"}`}>A–Z</Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm font-black uppercase tracking-wider text-cyan-300 sm:inline">Season Stats {season ?? "—"}</span>
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold text-slate-200 transition hover:border-cyan-400/60 hover:text-cyan-200 [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal aria-hidden="true" size={16} /><span className="sm:hidden">{season ?? "Settings"}</span><span className="hidden sm:inline">Grid settings</span><ChevronDown aria-hidden="true" size={14} className="transition group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-[min(24rem,calc(100vw-2.5rem))] rounded-2xl border border-slate-700 bg-[#07111f] p-4 shadow-2xl shadow-slate-950">
              <h3 className="text-lg font-black">Player Grid Settings</h3>
              <p className="mt-1 text-xs text-slate-400">Choose season, scoring, and season type.</p>
              <form className="mt-4 grid grid-cols-2 gap-3">
                <input type="hidden" name="position" value={filters.position} />
                <input type="hidden" name="view" value={filters.view} />
                <label className="col-span-2 text-xs font-bold uppercase tracking-wider text-slate-400">Season
                  <select name="season" defaultValue={season} className="mt-1 block w-full rounded-lg border bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white">{seasons.map((item) => <option key={item}>{item}</option>)}</select>
                </label>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Scoring
                  <select name="scoring" defaultValue={filters.scoring} className="mt-1 block w-full rounded-lg border bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white"><option value="ppr">PPR</option><option value="half_ppr">Half PPR</option><option value="standard">Standard</option></select>
                </label>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Season type
                  <select name="seasonType" defaultValue={filters.seasonType} className="mt-1 block w-full rounded-lg border bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white"><option value="REG">Regular</option><option value="POST">Postseason</option></select>
                </label>
                <Button className="col-span-2 mt-1">Apply settings</Button>
              </form>
            </div>
          </details>
        </div>
      </div>

      <nav aria-label="Position filter" className="mt-4 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
        {POSITIONS.map((position) => <Link key={position} href={href({ position, sort: "fantasy_points", view: "leaders", page: 1 })} aria-current={filters.position === position ? "page" : undefined} className={`min-w-16 rounded-full border px-4 py-2 text-center text-sm font-black transition sm:min-w-20 ${filters.position === position ? "border-cyan-300 bg-cyan-400/15 text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.12)]" : "border-slate-800 bg-slate-900/80 text-slate-400 hover:border-slate-600 hover:text-white"}`}>{position}</Link>)}
      </nav>

      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
        <p>{season ? `${result.total.toLocaleString()} ${filters.position === "ALL" ? "fantasy players" : filters.position === "FLEX" ? "flex players" : `${filters.position}s`}` : "No season available"} · {filters.seasonType} · {filters.scoring.replace("_", " ").toUpperCase()}</p>
        <p className="shrink-0 sm:hidden">Swipe stats →</p>
      </div>
    </section>

    <div className="mt-3">
      {error ? <Card className="text-center"><h2 className="font-bold">Player data unavailable</h2><p className="mt-2 text-slate-400">{error}</p></Card>
        : result.rows.length && season ? <PlayerLeaderboard rows={result.rows} columns={columns} scoring={filters.scoring} activeSort={filters.sort} season={season} seasonType={filters.seasonType} page={filters.page} pageSize={result.pageSize} buildHref={href} />
          : <Card className="text-center"><h2 className="font-bold">No player statistics found</h2><p className="mt-2 text-slate-400">Try another season, season type, scoring format, or position.</p></Card>}
    </div>

    {!error && result.total > result.pageSize && <nav aria-label="Leaderboard pagination" className="mt-4 flex items-center justify-between">
      <Link aria-disabled={filters.page <= 1} className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-bold ${filters.page <= 1 ? "pointer-events-none text-slate-600" : "text-cyan-300 hover:bg-slate-900"}`} href={href({ page: filters.page - 1 })}><ChevronLeft size={16} /> Previous</Link>
      <span className="text-xs font-semibold text-slate-400">Page {filters.page} of {totalPages}</span>
      <Link aria-disabled={filters.page >= totalPages} className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-bold ${filters.page >= totalPages ? "pointer-events-none text-slate-600" : "text-cyan-300 hover:bg-slate-900"}`} href={href({ page: filters.page + 1 })}>Next <ChevronRight size={16} /></Link>
    </nav>}

    <p className="mt-4 text-xs text-slate-500">Select a position to load its most useful stats. All sorting remains database-backed. Unavailable nflverse fields, including snap share, render as —.</p>
  </div>;
}
