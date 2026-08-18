import { PlayerLink } from "@/components/players/player-link";
import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { PlayerAvatar } from "@/components/players/player-avatar";
import { formatStatValue, SCORING_COLUMNS, type StatColumn } from "@/lib/players/filters";
import type { LeaderSort, PlayerSeasonRow, ScoringFormat } from "@/lib/players/types";

export function PlayerLeaderboard({ rows, columns, scoring, leagueId, activeSort, season, seasonType, page, pageSize, buildHref }: {
  rows: PlayerSeasonRow[];
  columns: StatColumn[];
  scoring: ScoringFormat;
  leagueId?: string | null;
  activeSort: LeaderSort;
  season: number;
  seasonType: "REG" | "POST";
  page: number;
  pageSize: number;
  buildHref: (changes: Record<string, string | number>) => string;
}) {
  const scoringFields = SCORING_COLUMNS[scoring];
  return <ol className="divide-y divide-slate-800/80 overflow-hidden rounded-2xl border border-slate-800 bg-[#081325]/90 shadow-2xl shadow-slate-950/30">
    {rows.map((row, index) => {
      const rank = (page - 1) * pageSize + index + 1;
      const team = row.season_teams || row.current_team || "FA";
      return <li key={row.player_id} className="group">
        <div className="grid grid-cols-[1.75rem_2rem_minmax(0,1fr)_4.5rem] items-center gap-1.5 px-2.5 py-1.5 sm:grid-cols-[2rem_2.25rem_minmax(0,1fr)_5rem] sm:gap-2.5 sm:px-4 sm:py-2">
          <span className="text-center font-mono text-base font-black text-slate-300 sm:text-lg">{rank}</span>
          <PlayerAvatar name={row.full_name} headshotUrl={row.headshot_url} />
          <div className="min-w-0">
            <PlayerLink playerId={row.player_id} query={`?season=${season}&scoring=${scoring}&seasonType=${seasonType}${leagueId ? `&leagueId=${leagueId}` : ""}`} className="block truncate text-sm font-black leading-tight text-slate-50 sm:text-base">{row.full_name}</PlayerLink>
            <p className="truncate text-[11px] font-semibold leading-4 text-slate-400 sm:text-xs"><span className="text-cyan-300">{row.historical_position || "—"}</span><span aria-hidden="true"> · </span>{team}<span aria-hidden="true"> · </span>{row.games_played} GP</p>
          </div>
          <div className="rounded-lg bg-slate-950/80 px-2 py-1 text-right ring-1 ring-slate-800">
            <span className="block text-[9px] font-bold tracking-wider text-slate-500 sm:text-[10px]">FPTS</span>
            <strong className="block text-base leading-5 text-cyan-200 sm:text-lg">{formatStatValue(row[scoringFields.points], { key: scoringFields.points, label: "FPTS", sort: "fantasy_points", tooltip: `${scoringFields.label} fantasy points`, digits: 1 })}</strong>
          </div>
        </div>
        <div className="touch-pan-x overflow-x-auto overscroll-x-contain border-t border-slate-800/80 bg-[#0b1730]/80 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]" aria-label={`${row.full_name} season statistics`}>
          <div className="flex min-w-max">
            {columns.map((item) => {
              const active = activeSort === item.sort;
              return <Link
                key={item.label}
                href={buildHref({ sort: item.sort, view: "leaders", page: 1 })}
                aria-label={`Sort by ${item.tooltip}`}
                title={item.tooltip}
                style={{ minWidth: item.width ?? 76 }}
                className={`border-r border-slate-800/70 px-2.5 py-1.5 transition last:border-r-0 hover:bg-slate-800/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyan-300 ${active ? "bg-cyan-400/8" : ""}`}
              >
                <span className={`flex items-center gap-1 whitespace-nowrap text-[10px] font-bold tracking-wide ${active ? "text-cyan-300" : "text-slate-500"}`}>{item.label}{active && <ArrowDown aria-hidden="true" size={11} />}</span>
                <strong className={`mt-0.5 block whitespace-nowrap text-sm tabular-nums ${active ? "text-cyan-200" : "text-slate-200"}`}>{formatStatValue(row[item.key], item)}</strong>
              </Link>;
            })}
          </div>
        </div>
      </li>;
    })}
  </ol>;
}
