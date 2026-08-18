import { PlayerAvatar } from "../players/player-avatar";
import { PlayerLink } from "../players/player-link";
import type { DepthChartPlayer } from "../../lib/nfl/depth-chart-service";

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K"];
const COMPACT_POSITION_ORDER = ["QB", "RB", "WR", "TE"];

export function DepthChart({ team, players, compact = false, highlightedPlayerId }: { team: string; players: DepthChartPlayer[]; compact?: boolean; highlightedPlayerId?: string }) {
  const fantasyPlayers = players.filter((player) => POSITION_ORDER.includes(player.position));

  if (compact) {
    const compactPlayers = fantasyPlayers.filter((player) => COMPACT_POSITION_ORDER.includes(player.position));
    const highlightedPlayer = compactPlayers.find((player) => player.id === highlightedPlayerId);

    return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-black text-cyan-200">{team} depth chart</h3>
        {highlightedPlayer ? <p className="text-xs font-bold text-cyan-300">{highlightedPlayer.depthPosition}{highlightedPlayer.depthRank} · current role</p> : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {COMPACT_POSITION_ORDER.map((position) => {
          const group = compactPlayers.filter((player) => player.position === position);
          if (!group.length) return null;
          return <div key={position} className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-2">
            <p className="text-[10px] font-black tracking-widest text-slate-500">{position}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">{group.map((player) => <PlayerLink
              key={player.id}
              playerId={player.id}
              ariaCurrent={player.id === highlightedPlayerId ? "true" : undefined}
              className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${player.id === highlightedPlayerId ? "bg-cyan-400/15 font-black text-cyan-100 ring-1 ring-cyan-400/40" : "bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"}`}
            >
              <span className="shrink-0 font-black text-cyan-300">{player.depthRank}</span>
              <span className="truncate">{player.name}</span>
            </PlayerLink>)}</div>
          </div>;
        })}
      </div>
      {!compactPlayers.length ? <p className="mt-3 text-sm text-slate-500">Depth data unavailable.</p> : null}
    </section>;
  }

  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
    <h3 className="font-black text-cyan-200">{team} depth chart</h3>
    {POSITION_ORDER.map((position) => {
      const group = fantasyPlayers.filter((player) => player.position === position);
      if (!group.length) return null;
      return <div key={position} className="mt-3">
        <p className="text-[10px] font-black tracking-widest text-slate-500">{position}</p>
        <div className="mt-1 divide-y divide-slate-800">{group.map((player) => <div
          key={player.id}
          className={`grid grid-cols-[1.75rem_2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg py-1.5 text-sm ${player.id === highlightedPlayerId ? "bg-cyan-400/10 ring-1 ring-cyan-400/30" : "hover:bg-slate-800/60"}`}
        >
          <span className="text-center font-black text-cyan-300">{player.depthRank}</span>
          <PlayerAvatar name={player.name} headshotUrl={player.headshotUrl} />
          <span className="min-w-0"><PlayerLink playerId={player.id} className="block truncate font-bold">{player.name}</PlayerLink><small className="text-slate-500">{player.depthPosition}{player.isStarter ? " · starter" : ""}</small></span>
          <span className="grid grid-cols-2 gap-2 text-right tabular-nums"><small><span className="block text-[8px] text-slate-600">VALUE</span>{player.playerValue?.toFixed(1) ?? "—"}</small><small><span className="block text-[8px] text-slate-600">PPG</span>{player.projectedPpg?.toFixed(1) ?? "—"}</small></span>
        </div>)}</div>
      </div>;
    })}
    {!fantasyPlayers.length ? <p className="mt-3 text-sm text-slate-500">Depth data unavailable.</p> : null}
  </section>;
}
