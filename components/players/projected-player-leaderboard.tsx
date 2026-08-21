import { PlayerLink } from "./player-link";
import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { PlayerAvatar } from "./player-avatar";
import type { ProjectedPlayerLeaderRow, ProjectionLeaderSort } from "@/lib/players/types";
import type { ProjectionScoringMode } from "@/lib/projections/types";

const POSITION_STATS: Record<string, Array<[string, string]>> = {
  QB: [["pass_attempts", "ATT"], ["completions", "COMP"], ["passing_yards", "PASS YD"], ["passing_touchdowns", "PASS TD"], ["interceptions_thrown", "INT"], ["rushing_yards", "RUSH YD"], ["rushing_touchdowns", "RUSH TD"]],
  RB: [["rush_attempts", "CAR"], ["rushing_yards", "RUSH YD"], ["rushing_touchdowns", "RUSH TD"], ["targets", "TAR"], ["receptions", "REC"], ["receiving_yards", "REC YD"], ["receiving_touchdowns", "REC TD"]],
  WR: [["targets", "TAR"], ["receptions", "REC"], ["receiving_yards", "REC YD"], ["receiving_touchdowns", "REC TD"], ["rushing_yards", "RUSH YD"], ["rushing_touchdowns", "RUSH TD"]],
  TE: [["targets", "TAR"], ["receptions", "REC"], ["receiving_yards", "REC YD"], ["receiving_touchdowns", "REC TD"]],
};

export function ProjectedPlayerLeaderboard({ rows, activeSort, leagueId, scoring, buildHref }: {
  rows: ProjectedPlayerLeaderRow[];
  activeSort: ProjectionLeaderSort;
  leagueId?: string | null;
  scoring: ProjectionScoringMode;
  buildHref: (changes: Record<string, string | number>) => string;
}) {
  const sorts: Array<[ProjectionLeaderSort, string]> = [["player_value", "VALUE"], ["value_rank", "RANK"], ["projected_ppg", "PROJ PPG"], ["projected_fpts", "PROJ FPTS"]];
  return <ol className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-[#081325]/90">
    {rows.map((row) => <li key={row.player_id}>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_5.5rem] items-center gap-2 px-3 py-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_7rem] sm:px-4">
        <PlayerAvatar name={row.full_name} headshotUrl={row.headshot_url} />
        <div className="min-w-0">
          <PlayerLink playerId={row.player_id} query={`?season=2026&scoring=${scoring}${leagueId ? `&leagueId=${leagueId}` : ""}`} className="block truncate text-sm font-black sm:text-base">{row.full_name}</PlayerLink>
          <p className="truncate text-[11px] font-semibold text-slate-400"><span className="text-cyan-300">{row.position}</span> · {row.team ?? "FA"}{row.depth_role ? ` · Depth ${row.depth_role}` : ""} · {row.position}#{row.position_rank}</p>
        </div>
        <div className="text-right"><strong className="block text-lg text-cyan-200">{row.player_value.toFixed(1)}</strong><span className="text-[10px] font-bold text-slate-500">VALUE · #{row.overall_rank}</span></div>
      </div>
      <div className="touch-pan-x overflow-x-auto border-t border-slate-800 bg-[#0b1730]/80">
        <div className="flex min-w-max">
          {sorts.map(([sort, label]) => <Link key={sort} href={buildHref({ sort, page: 1 })} className={`min-w-20 border-r border-slate-800 px-2.5 py-1.5 ${activeSort === sort ? "bg-cyan-400/8" : ""}`}><span className={`flex items-center gap-1 text-[10px] font-bold ${activeSort === sort ? "text-cyan-300" : "text-slate-500"}`}>{label}{activeSort === sort && <ArrowDown size={11} />}</span><strong className="block text-sm tabular-nums">{sort === "player_value" ? row.player_value.toFixed(1) : sort === "value_rank" ? `#${row.overall_rank}` : sort === "projected_ppg" ? row.projected_ppg.toFixed(1) : row.projected_fpts.toFixed(1)}</strong></Link>)}
          {(POSITION_STATS[row.position] ?? []).map(([key, label]) => { const value = row.projected_stats[key as keyof typeof row.projected_stats]; return <div key={key} className="min-w-20 border-r border-slate-800 px-2.5 py-1.5"><span className="text-[10px] font-bold text-slate-500">{label}</span><strong className="block text-sm tabular-nums">{value == null ? "—" : Number(value).toFixed(1)}</strong></div>; })}
        </div>
      </div>
    </li>)}
  </ol>;
}
