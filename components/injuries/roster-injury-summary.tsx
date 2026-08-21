import { Card } from "@/components/ui/card";
import { PlayerLink } from "@/components/players/player-link";
import { InjuryBadge } from "./injury-badge";

interface InjuredPlayer {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  projected_ppg: number | null;
  active_game_ppg?: number | null;
  availability_adjustment?: number | null;
  injury_status?: string | null;
  injury_status_label?: string | null;
  injury_timeline?: string | null;
  practice_participation?: string | null;
  injury_data_stale?: boolean;
  current_week_active_probability?: number | null;
}

export function RosterInjurySummary({ players, playerQuery, title = "Roster availability" }: { players: InjuredPlayer[]; playerQuery?: string; title?: string }) {
  const injured = players.filter((player) => player.injury_status && !["healthy", "unknown"].includes(player.injury_status)).sort((a, b) => Number(a.projected_ppg ?? 0) - Number(b.projected_ppg ?? 0));
  if (!injured.length) return null;
  const counts = injured.reduce<Record<string, number>>((result, player) => ({ ...result, [player.injury_status!]: (result[player.injury_status!] ?? 0) + 1 }), {});
  return <Card className="p-4" aria-label="Roster injuries">
    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">{title}</p>
    <p className="mt-1 text-sm text-slate-400">{Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(" · ")}</p>
    <div className="mt-3 divide-y divide-slate-800">
      {injured.slice(0, 5).map((player) => <div key={player.id} className="py-2.5 first:pt-0 last:pb-0">
        <div className="flex items-center justify-between gap-2"><PlayerLink playerId={player.id} query={playerQuery} className="truncate text-sm font-bold">{player.full_name}</PlayerLink><InjuryBadge status={player.injury_status} label={player.injury_status_label} stale={player.injury_data_stale} /></div>
        <p className="mt-1 text-xs text-slate-500">{player.position ?? "—"} · {player.team ?? "FA"}{player.practice_participation ? ` · ${player.practice_participation}` : ""}</p>
        <p className="mt-1 text-xs text-slate-400">{player.injury_timeline ?? "Return timetable unknown"} · {player.projected_ppg?.toFixed(1) ?? "—"} expected PPG{player.active_game_ppg != null && player.active_game_ppg !== player.projected_ppg ? ` (${player.active_game_ppg.toFixed(1)} if active)` : ""}</p>
        {player.current_week_active_probability != null && player.current_week_active_probability < 1 && player.availability_adjustment != null && player.availability_adjustment < -0.05 ? <p className="mt-1 text-xs font-semibold text-rose-300">Value impact {player.availability_adjustment.toFixed(1)}</p> : null}
      </div>)}
    </div>
  </Card>;
}
