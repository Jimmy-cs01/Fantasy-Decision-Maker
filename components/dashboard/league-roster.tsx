import { PlayerAvatar } from "../players/player-avatar";

export interface LeagueRosterPlayer {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  headshot_url: string | null;
  is_starter: boolean;
  roster_slot: string | null;
  roster_slot_index: number | null;
  previous_season_ppg: number | null;
}

export function LeagueRoster({ players, ppgSeason }: { players: LeagueRosterPlayer[]; ppgSeason: number | null }) {
  const starters = players.filter((player) => player.is_starter);
  const bench = players.filter((player) => !player.is_starter);
  return <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/45">
    <RosterGroup title="STARTERS" players={starters} ppgSeason={ppgSeason} />
    <RosterGroup title="BENCH" players={bench} ppgSeason={ppgSeason} bench />
  </div>;
}

function RosterGroup({ title, players, ppgSeason, bench = false }: {
  title: string;
  players: LeagueRosterPlayer[];
  ppgSeason: number | null;
  bench?: boolean;
}) {
  return <section aria-label={title === "STARTERS" ? "Starting lineup" : "Bench"}>
    <div className={`flex items-center justify-between border-y border-slate-800 px-3 py-1.5 first:border-t-0 ${bench ? "bg-slate-900/85" : "bg-cyan-400/7"}`}>
      <h3 className="text-[10px] font-black tracking-[0.2em] text-slate-400">{title}</h3>
      <span className="text-[10px] font-semibold text-slate-500">{ppgSeason ? `${ppgSeason} REG PPG` : "REG PPG"}</span>
    </div>
    {players.length ? <div className="divide-y divide-slate-800/80">
      {players.map((player) => <RosterRow key={player.id} player={player} bench={bench} />)}
    </div> : <p className="px-3 py-4 text-sm text-slate-500">No {bench ? "bench players" : "starters"} available.</p>}
  </section>;
}

function RosterRow({ player, bench }: { player: LeagueRosterPlayer; bench: boolean }) {
  const ppg = player.previous_season_ppg;
  const slot = player.roster_slot || "START";
  const compactSlot = slot === "SUPERFLEX" ? "SFLEX" : slot;
  return <div className="grid min-h-16 grid-cols-[3.5rem_2.25rem_minmax(0,1fr)_3.5rem] items-center gap-2.5 px-2.5 py-2 sm:grid-cols-[4rem_2.5rem_minmax(0,1fr)_4rem] sm:px-3">
    <span title={bench ? "Bench" : slot} className={`grid h-10 place-items-center rounded-xl px-1 text-[11px] font-black tracking-wide shadow-sm sm:h-11 sm:text-xs ${slotBadgeClass(bench ? "BN" : slot)}`}>
      {bench ? "BN" : compactSlot}
    </span>
    <PlayerAvatar name={player.full_name} headshotUrl={player.headshot_url} />
    <div className="min-w-0 leading-tight">
      <p className="truncate text-sm font-bold text-slate-50 sm:text-[15px]">{player.full_name}</p>
      <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500 sm:text-xs">
        {player.team || "FA"} <span aria-hidden="true">•</span> {player.position || "—"}
      </p>
    </div>
    <span className="text-right text-sm font-black tabular-nums text-slate-200" aria-label={ppg == null ? "PPG unavailable" : `${ppg.toFixed(1)} points per game`}>
      {ppg == null ? "—" : ppg.toFixed(1)}
    </span>
  </div>;
}

export function slotBadgeClass(slot: string) {
  switch (slot) {
    case "QB": return "bg-pink-400 text-slate-950";
    case "RB": return "bg-emerald-300 text-slate-950";
    case "WR": return "bg-sky-400 text-slate-950";
    case "TE": return "bg-orange-300 text-slate-950";
    case "SUPERFLEX": return "bg-gradient-to-r from-pink-400 via-sky-400 to-emerald-300 text-slate-950";
    case "FLEX": return "bg-gradient-to-r from-sky-400 via-emerald-300 to-orange-300 text-slate-950";
    case "K": return "bg-violet-300 text-slate-950";
    default: return "bg-slate-800 text-slate-400";
  }
}
