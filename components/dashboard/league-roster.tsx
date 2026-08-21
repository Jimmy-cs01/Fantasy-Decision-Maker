import { PlayerAvatar } from "../players/player-avatar";
import { PlayerLink } from "../players/player-link";
import { InjuryBadge } from "../injuries/injury-badge";

export interface LeagueRosterPlayer {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  headshot_url: string | null;
  is_starter: boolean;
  roster_slot: string | null;
  roster_slot_index: number | null;
  projected_ppg: number | null;
  player_value: number | null;
  position_rank: number | null;
  overall_rank: number | null;
  value_tier: string | null;
  confidence: string | null;
  injury_status?: string | null;
  injury_status_label?: string | null;
  injury_data_stale?: boolean;
}

export function LeagueRoster({ players, projectionLabel, leagueId, playerQuery }: { players: LeagueRosterPlayer[]; projectionLabel: string | null; leagueId: string; playerQuery?: string }) {
  const starters = players.filter((player) => player.is_starter);
  const bench = players.filter((player) => !player.is_starter);
  return <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/45">
    <RosterGroup title="STARTERS" players={starters} projectionLabel={projectionLabel} leagueId={leagueId} playerQuery={playerQuery} />
    <RosterGroup title="BENCH" players={bench} projectionLabel={projectionLabel} leagueId={leagueId} playerQuery={playerQuery} bench />
  </div>;
}

function RosterGroup({ title, players, projectionLabel, leagueId, playerQuery, bench = false }: {
  title: string;
  players: LeagueRosterPlayer[];
  projectionLabel: string | null;
  leagueId: string;
  playerQuery?: string;
  bench?: boolean;
}) {
  return <section aria-label={title === "STARTERS" ? "Starting lineup" : "Bench"}>
    <div className={`flex items-center justify-between border-y border-slate-800 px-3 py-1.5 first:border-t-0 ${bench ? "bg-slate-900/85" : "bg-cyan-400/7"}`}>
      <h3 className="text-[10px] font-black tracking-[0.2em] text-slate-400">{title}</h3>
      <span className="text-[10px] font-semibold text-slate-500">{projectionLabel ? `${projectionLabel} PROJ` : "PROJECTION"}</span>
    </div>
    {players.length ? <div className="divide-y divide-slate-800/80">
      {players.map((player) => <RosterRow key={player.id} player={player} bench={bench} leagueId={leagueId} playerQuery={playerQuery} />)}
    </div> : <p className="px-3 py-4 text-sm text-slate-500">No {bench ? "bench players" : "starters"} available.</p>}
  </section>;
}

function RosterRow({ player, bench, leagueId, playerQuery }: { player: LeagueRosterPlayer; bench: boolean; leagueId: string; playerQuery?: string }) {
  const ppg = player.projected_ppg;
  const slot = player.roster_slot || "START";
  const compactSlot = slot === "SUPERFLEX" ? "SFLEX" : slot;
  return <div className="grid min-h-16 grid-cols-[3.5rem_2.25rem_minmax(0,1fr)_4.25rem] items-center gap-2.5 px-2.5 py-2 transition hover:bg-slate-800/45 sm:grid-cols-[4rem_2.5rem_minmax(0,1fr)_5rem] sm:px-3">
    <span title={bench ? "Bench" : slot} className={`grid h-10 place-items-center rounded-xl px-1 text-[11px] font-black tracking-wide shadow-sm sm:h-11 sm:text-xs ${slotBadgeClass(bench ? "BN" : slot)}`}>
      {bench ? "BN" : compactSlot}
    </span>
    <PlayerAvatar name={player.full_name} headshotUrl={player.headshot_url} />
    <div className="min-w-0 leading-tight">
      <PlayerLink playerId={player.id} query={playerQuery ?? `?scoring=league&leagueId=${leagueId}`} className="block truncate text-sm font-bold text-slate-50 sm:text-[15px]">{player.full_name}</PlayerLink>
      <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500 sm:text-xs">
        {player.team || "FA"} <span aria-hidden="true">•</span> {player.position || "—"}
      </p>
      <div className="mt-1"><InjuryBadge status={player.injury_status} label={player.injury_status_label} stale={player.injury_data_stale} /></div>
    </div>
    <span className="text-right tabular-nums" aria-label={ppg == null ? "Projected PPG unavailable" : `${ppg.toFixed(1)} projected points per game`}>
      <span className="block text-sm font-black text-slate-100">{ppg == null ? "—" : ppg.toFixed(1)}</span>
      <span className="mt-0.5 block text-[10px] font-bold text-cyan-300">{player.player_value == null ? "VALUE —" : `VALUE ${player.player_value.toFixed(1)}`}</span>
      {player.position_rank != null && <span className="mt-0.5 block text-[9px] font-semibold text-slate-500">{player.position}{player.position_rank}</span>}
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
