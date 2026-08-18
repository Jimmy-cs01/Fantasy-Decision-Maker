import Link from "next/link";
import { PlayerAvatar } from "../players/player-avatar";
import type { DepthChartPlayer } from "../../lib/nfl/depth-chart-service";

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K"];

export function DepthChart({ team, players, compact = false }: { team: string; players: DepthChartPlayer[]; compact?: boolean }) {
  const fantasyPlayers = players.filter((player) => POSITION_ORDER.includes(player.position));
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
    <h3 className="font-black text-cyan-200">{team} depth chart</h3>
    {POSITION_ORDER.map((position) => {
      const group = fantasyPlayers.filter((player) => player.position === position);
      if (!group.length) return null;
      return <div key={position} className="mt-3">
        <p className="text-[10px] font-black tracking-widest text-slate-500">{position}</p>
        <div className="mt-1 divide-y divide-slate-800">{group.map((player) => <Link
          key={player.id} href={`/players/${player.id}`}
          className={`grid grid-cols-[1.75rem_2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg py-1.5 hover:bg-slate-800/60 ${compact ? "text-xs" : "text-sm"}`}
        >
          <span className="text-center font-black text-cyan-300">{player.depthRank}</span>
          <PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} />
          <span className="min-w-0"><b className="block truncate">{player.name}</b><small className="text-slate-500">{player.depthPosition}{player.isStarter ? " · starter" : ""}</small></span>
          <span className="grid grid-cols-2 gap-2 text-right tabular-nums"><small><span className="block text-[8px] text-slate-600">VALUE</span>{player.playerValue?.toFixed(1) ?? "—"}</small><small><span className="block text-[8px] text-slate-600">PPG</span>{player.projectedPpg?.toFixed(1) ?? "—"}</small></span>
        </Link>)}</div>
      </div>;
    })}
    {!fantasyPlayers.length ? <p className="mt-3 text-sm text-slate-500">Depth data unavailable.</p> : null}
  </section>;
}
