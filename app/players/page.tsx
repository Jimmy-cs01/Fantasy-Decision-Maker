import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlayerLeaderboard } from "@/components/players/player-leaderboard";
import { ProjectedPlayerLeaderboard } from "@/components/players/projected-player-leaderboard";
import { PositionFilterNav } from "@/components/players/position-filter";
import { PlayerSearch } from "@/components/players/player-search";
import { parsePlayerFilters, positionColumns, POSITIONS, resolveScoringSelection, resolveSeason } from "@/lib/players/filters";
import { getAvailableSeasons, getPlayerLeaders, getProjectedPlayerLeaders, getScoringLeagues } from "@/lib/players/queries";
import { DEFAULT_VALUE_LEAGUE } from "@/lib/player-values/config";
import type { ProjectionLeaderSort } from "@/lib/players/types";
import { publicPlayerDataMessage } from "@/lib/players/data-errors";
import { projectionScoringLabel } from "@/lib/projections/presentation";

const first = (input: string | string[] | undefined) => Array.isArray(input) ? input[0] : input;

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filters = parsePlayerFilters(params);
  let seasons: number[] = [];
  let scoringLeagues: Awaited<ReturnType<typeof getScoringLeagues>> = [];
  let error = "";
  try {
    seasons = [...new Set([2026, ...await getAvailableSeasons(filters.seasonType)])].sort((left, right) => right - left);
  } catch (cause) {
    console.error(cause);
    error = publicPlayerDataMessage(cause);
  }
  try {
    scoringLeagues = await getScoringLeagues();
  } catch (cause) {
    console.error("Unable to load synced league scoring; manual scoring remains available.", cause);
  }
  const requestedSeason = Number.parseInt(first(params.season) ?? "", 10);
  const season = resolveSeason(requestedSeason, seasons);
  const selectedLeague = scoringLeagues.find((league) => league.id === filters.leagueId) ?? scoringLeagues[0] ?? null;
  const scoring = resolveScoringSelection(first(params.scoring), Boolean(selectedLeague));
  const mode = season === 2026 && first(params.mode) !== "actual" ? "projected" : "actual";
  const requestedProjectionSort = first(params.sort) as ProjectionLeaderSort | undefined;
  const projectionSort: ProjectionLeaderSort = ["player_value", "value_rank", "projected_ppg", "projected_fpts"].includes(requestedProjectionSort ?? "") ? requestedProjectionSort! : "player_value";
  let result = { rows: [], total: 0, pageSize: 50 } as Awaited<ReturnType<typeof getPlayerLeaders>>;
  let projectionResult = { rows: [], total: 0, pageSize: 50, season: null } as Awaited<ReturnType<typeof getProjectedPlayerLeaders>>;
  if (season && !error && mode === "actual") {
    try {
      result = await getPlayerLeaders({ season, ...filters, scoring, scoringSettings: scoring === "league" ? selectedLeague?.scoring_settings : undefined });
    } catch (cause) {
      console.error(cause);
      error = publicPlayerDataMessage(cause);
    }
  }
  if (season === 2026 && !error && mode === "projected") {
    const scoringSettings = scoring === "league" ? selectedLeague?.scoring_settings ?? { rec: 1 }
      : scoring === "ppr" ? { rec: 1 } : scoring === "half_ppr" ? { rec: 0.5 } : { rec: 0 };
    const rosterPositions = selectedLeague?.roster_positions ?? DEFAULT_VALUE_LEAGUE.rosterPositions;
    try {
      projectionResult = await getProjectedPlayerLeaders({
        position: filters.position, scoring, scoringSettings, sort: projectionSort, page: filters.page,
        leagueConfig: { teams: Number(selectedLeague?.total_rosters ?? DEFAULT_VALUE_LEAGUE.teams), rosterPositions, scoringSettings },
      });
    } catch (cause) {
      console.error(cause);
      error = publicPlayerDataMessage(cause);
    }
  }
  const columns = positionColumns(filters.position, scoring);
  const activeResult = mode === "projected" ? projectionResult : result;
  const totalPages = Math.max(1, Math.ceil(activeResult.total / activeResult.pageSize));
  const href = (changes: Record<string, string | number>) => {
    const query = new URLSearchParams({
      season: String(season ?? ""), scoring, position: filters.position,
      seasonType: filters.seasonType, sort: mode === "projected" ? projectionSort : filters.sort, view: filters.view, mode,
      page: String(filters.page),
      ...(selectedLeague ? { leagueId: selectedLeague.id } : {}),
      ...Object.fromEntries(Object.entries(changes).map(([key, item]) => [key, String(item)])),
    });
    return `/players?${query}`;
  };

  return <div className="mx-auto max-w-7xl">
    <header>
      <p className="text-xs font-black tracking-[0.22em] text-cyan-300">PLAYER EXPLORER</p>
      <h1 className="text-2xl font-black tracking-tight sm:mt-1 sm:text-3xl">NFL & Fantasy Leaders</h1>
      <p className="mt-1 hidden text-sm text-slate-400 sm:block">Dense, position-aware nflverse season statistics.</p>
    </header>

    <div className="mt-3 sm:mt-4"><PlayerSearch /></div>

    <section className="mt-3 sm:mt-5" aria-labelledby="leaders-heading">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <h2 id="leaders-heading" className="text-lg font-black sm:text-2xl">Leaders</h2>
          <nav aria-label="Leaderboard view" className="flex rounded-lg bg-slate-900 p-1 text-xs font-bold">
            <Link href={href({ view: "leaders", page: 1 })} aria-current={filters.view === "leaders" ? "page" : undefined} className={`rounded-md px-2 py-1 sm:px-2.5 sm:py-1.5 ${filters.view === "leaders" ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:text-white"}`}>Ranked</Link>
            <Link href={href({ view: "all", page: 1 })} aria-current={filters.view === "all" ? "page" : undefined} className={`rounded-md px-2 py-1 sm:px-2.5 sm:py-1.5 ${filters.view === "all" ? "bg-cyan-400 text-slate-950" : "text-slate-400 hover:text-white"}`}>A–Z</Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm font-black uppercase tracking-wider text-cyan-300 sm:inline">{mode === "projected" ? "Projected" : "Season Stats"} {season ?? "—"}</span>
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold text-slate-200 transition hover:border-cyan-400/60 hover:text-cyan-200 [&::-webkit-details-marker]:hidden">
              <SlidersHorizontal aria-hidden="true" size={16} /><span className="whitespace-nowrap sm:hidden">{season ?? "—"} {filters.seasonType} · {scoring === "league" ? "League" : scoring.replace("_", " ").toUpperCase()}</span><span className="hidden sm:inline">Grid settings</span><ChevronDown aria-hidden="true" size={14} className="hidden transition group-open:rotate-180 sm:block" />
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
                  <select name="scoring" defaultValue={scoring} className="mt-1 block w-full rounded-lg border bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white">{scoringLeagues.length > 0 && <option value="league">League Scoring</option>}<option value="ppr">PPR</option><option value="half_ppr">Half PPR</option><option value="standard">Standard</option></select>
                </label>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Season type
                  <select name="seasonType" defaultValue={filters.seasonType} className="mt-1 block w-full rounded-lg border bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white"><option value="REG">Regular</option><option value="POST">Postseason</option></select>
                </label>
                {scoringLeagues.length > 0 && <label className="col-span-2 text-xs font-bold uppercase tracking-wider text-slate-400">Sleeper league
                  <select name="leagueId" defaultValue={selectedLeague?.id} className="mt-1 block w-full rounded-lg border bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white">{scoringLeagues.map((league) => <option key={league.id} value={league.id}>{league.name} · {league.season}</option>)}</select>
                  <span className="mt-1 block normal-case tracking-normal text-slate-500">League scoring uses supported Sleeper passing, rushing, receiving, reception-bonus, and first-down values.</span>
                </label>}
                <Button className="col-span-2 mt-1">Apply settings</Button>
              </form>
            </div>
          </details>
        </div>
      </div>

      {season === 2026 && <nav aria-label="2026 data mode" className="mt-3 inline-flex rounded-xl bg-slate-900 p-1 text-xs font-black"><Link href={href({ mode: "projected", sort: "player_value", page: 1 })} className={`rounded-lg px-3 py-2 ${mode === "projected" ? "bg-cyan-400 text-slate-950" : "text-slate-400"}`}>Projected</Link><Link href={href({ mode: "actual", sort: "fantasy_points", page: 1 })} className={`rounded-lg px-3 py-2 ${mode === "actual" ? "bg-cyan-400 text-slate-950" : "text-slate-400"}`}>Season Stats</Link></nav>}
      <div className="mt-3 sm:mt-4"><PositionFilterNav selected={filters.position} items={POSITIONS.map((position) => ({ position, href: href({ position, sort: mode === "projected" ? "player_value" : "fantasy_points", view: "leaders", page: 1 }) }))} /></div>

      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
        <p>{season ? `${activeResult.total.toLocaleString()} ${filters.position === "ALL" ? "fantasy players" : filters.position === "FLEX" ? "flex players" : `${filters.position}s`}` : "No season available"} · {mode === "projected" ? "PROJECTED" : filters.seasonType} · {mode === "projected" ? projectionScoringLabel(scoring, selectedLeague?.name) : scoring === "league" ? `${selectedLeague?.name} scoring` : scoring.replace("_", " ").toUpperCase()}</p>
        <p className="shrink-0 sm:hidden">Swipe stats →</p>
      </div>
    </section>

    <div className="mt-3">
      {error ? <Card className="text-center"><h2 className="font-bold">Player data unavailable</h2><p className="mt-2 text-slate-400">{error}</p></Card>
        : mode === "projected" && projectionResult.rows.length ? <ProjectedPlayerLeaderboard rows={projectionResult.rows} activeSort={projectionSort} leagueId={selectedLeague?.id} scoring={scoring} buildHref={href} />
        : result.rows.length && season ? <PlayerLeaderboard rows={result.rows} columns={columns} scoring={scoring} leagueId={selectedLeague?.id} activeSort={filters.sort} season={season} seasonType={filters.seasonType} page={filters.page} pageSize={result.pageSize} buildHref={href} />
          : <Card className="text-center"><h2 className="font-bold">No {mode === "projected" ? "projections" : "player statistics"} found</h2><p className="mt-2 text-slate-400">{season === 2026 && mode === "actual" ? "The 2026 regular season has not produced nflverse rows yet. This view will populate after the weekly import." : "Try another season, season type, scoring format, or position."}</p></Card>}
    </div>

    {!error && activeResult.total > activeResult.pageSize && <nav aria-label="Leaderboard pagination" className="mt-4 flex items-center justify-between">
      <Link aria-disabled={filters.page <= 1} className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-bold ${filters.page <= 1 ? "pointer-events-none text-slate-600" : "text-cyan-300 hover:bg-slate-900"}`} href={href({ page: filters.page - 1 })}><ChevronLeft size={16} /> Previous</Link>
      <span className="text-xs font-semibold text-slate-400">Page {filters.page} of {totalPages}</span>
      <Link aria-disabled={filters.page >= totalPages} className={`flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-bold ${filters.page >= totalPages ? "pointer-events-none text-slate-600" : "text-cyan-300 hover:bg-slate-900"}`} href={href({ page: filters.page + 1 })}>Next <ChevronRight size={16} /></Link>
    </nav>}

    <p className="mt-4 text-xs text-slate-500">Select a position to load its most useful stats. All sorting remains database-backed. Unavailable nflverse fields, including snap share, render as —.</p>
  </div>;
}
