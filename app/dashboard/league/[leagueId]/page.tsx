import Link from "next/link";
import { notFound } from "next/navigation";
import { LeagueRoster, type LeagueRosterPlayer } from "@/components/dashboard/league-roster";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { assignStarterSlots, normalizeLineupSlot, orderRosterPlayers, selectLeagueTeam } from "@/lib/fantasy/roster-order";
import { latestCompletedSeason, rosterPlayerPpg, type RosterSeasonStatLine } from "@/lib/fantasy/roster-stats";
import type { SleeperScoringSettings } from "@/lib/fantasy/league-scoring";
import { createClient } from "@/lib/supabase/server";
import { syncLeague } from "../../actions";

const first = (input: string | string[] | undefined) => Array.isArray(input) ? input[0] : input;

interface RosterPlayerIdentity {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  headshot_url: string | null;
  sleeper_player_id: string | null;
}

interface RosterPlayerRelation {
  is_starter: boolean;
  roster_slot: string | null;
  roster_slot_index: number | null;
  players: RosterPlayerIdentity | RosterPlayerIdentity[] | null;
}

export default async function LeaguePage({ params, searchParams }: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: league } = await db.from("leagues").select("*").eq("id", leagueId).eq("owner_id", user!.id).maybeSingle();
  if (!league) notFound();

  const [{ data: teamsData }, { data: members }, { data: account }] = await Promise.all([
    db.from("fantasy_teams").select("id,name,wins,losses,ties,league_member_id,sleeper_roster_id").eq("league_id", league.id).order("sleeper_roster_id"),
    db.from("league_members").select("id,sleeper_user_id,username,display_name").eq("league_id", league.id),
    db.from("sleeper_accounts").select("sleeper_user_id").eq("user_id", user!.id).limit(1).maybeSingle(),
  ]);
  const personalMemberId = (members ?? []).find((member) => member.sleeper_user_id === account?.sleeper_user_id)?.id ?? null;
  const membersById = new Map((members ?? []).map((member) => [member.id, member]));
  const teams = (teamsData ?? []).map((team) => {
    const owner = team.league_member_id ? membersById.get(team.league_member_id) : null;
    return {
      ...team,
      ownerName: owner?.display_name || owner?.username || null,
      isMyTeam: team.league_member_id === personalMemberId,
    };
  });
  const selectedTeam = selectLeagueTeam(teams, first(query.teamId) ?? null, personalMemberId);

  let players: LeagueRosterPlayer[] = [];
  let ppgSeason: number | null = null;
  if (selectedTeam) {
    const { data: roster } = await db.from("rosters").select("id,starters").eq("fantasy_team_id", selectedTeam.id).maybeSingle();
    if (roster) {
      const fallbackAssignments = assignStarterSlots((roster.starters ?? []) as Array<string | null>, league.roster_positions ?? []);
      const { data, error: rosterError } = await db.from("roster_players")
        .select("is_starter,roster_slot,roster_slot_index,players(id,sleeper_player_id,full_name,position,team,headshot_url)")
        .eq("roster_id", roster.id);
      if (rosterError) console.error("Unable to load roster players", rosterError);
      const rosterPlayers: LeagueRosterPlayer[] = ((data ?? []) as RosterPlayerRelation[]).flatMap((entry) => {
        const identity = Array.isArray(entry.players) ? entry.players[0] : entry.players;
        const storedSlot = normalizeLineupSlot(entry.roster_slot);
        const fallback = identity?.sleeper_player_id ? fallbackAssignments.get(identity.sleeper_player_id) : undefined;
        const useFallback = entry.is_starter && (!storedSlot || ["STARTER", "BN", "BENCH"].includes(storedSlot));
        return identity ? [{
          ...identity,
          is_starter: entry.is_starter,
          roster_slot: useFallback ? fallback?.rosterSlot ?? entry.roster_slot : entry.roster_slot,
          roster_slot_index: useFallback ? fallback?.rosterSlotIndex ?? entry.roster_slot_index : entry.roster_slot_index,
          previous_season_ppg: null,
        }] : [];
      });

      if (rosterPlayers.length) {
        const currentYear = new Date().getFullYear();
        const { data: seasonData, error: seasonError } = await db.from("available_player_seasons")
          .select("season")
          .eq("season_type", "REG")
          .lt("season", currentYear)
          .order("season", { ascending: false });
        if (seasonError) console.error("Unable to resolve previous player-stat season", seasonError);
        ppgSeason = latestCompletedSeason((seasonData ?? []).map((row) => Number(row.season)), currentYear);
        if (ppgSeason) {
          const { data: stats, error: statsError } = await db.from("player_season_stats")
            .select("*")
            .in("player_id", rosterPlayers.map((player) => player.id))
            .eq("season", ppgSeason)
            .eq("season_type", "REG");
          if (statsError) console.error("Unable to load roster PPG", statsError);
          const statsByPlayer = new Map(((stats ?? []) as RosterSeasonStatLine[]).map((row) => [row.player_id, row]));
          const settings = league.scoring_settings as SleeperScoringSettings;
          for (const player of rosterPlayers) {
            player.previous_season_ppg = rosterPlayerPpg(statsByPlayer.get(player.id), settings);
          }
        }
      }
      players = orderRosterPlayers(rosterPlayers);
    }
  }

  const positionCounts = players.reduce<Record<string, number>>((counts, player) => {
    const key = player.position || "Other";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const teamName = (team: typeof teams[number]) => team.name || team.ownerName || `Team ${team.sleeper_roster_id}`;

  return <div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-black tracking-[0.2em] text-cyan-300">LEAGUE OVERVIEW</p>
        <h1 className="mt-1 text-2xl font-black sm:text-3xl">{league.name}</h1>
        <p className="mt-1.5 text-sm text-slate-400">{league.season} · {league.season_type ?? "regular"} · {league.total_rosters ?? teams.length} teams</p>
      </div>
      <form action={syncLeague}>
        <input type="hidden" name="leagueId" value={league.id} />
        <Button>Sync League</Button>
      </form>
    </div>
    <p className="mt-3 text-xs text-slate-500">Last synchronization: {league.last_synced_at ? new Date(league.last_synced_at).toLocaleString() : "Not yet synced"}</p>

    <nav aria-label="League teams" className="mt-5 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
      {teams.map((team) => <Link
        key={team.id}
        href={`/dashboard/league/${league.id}?teamId=${team.id}`}
        aria-current={selectedTeam?.id === team.id ? "page" : undefined}
        className={`min-w-max rounded-full border px-3.5 py-2 text-sm font-bold transition ${selectedTeam?.id === team.id ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 bg-slate-900 text-slate-400 hover:text-white"}`}
      >
        {team.isMyTeam ? "My Team" : teamName(team)}
        {team.isMyTeam && teamName(team) !== "My Team" ? <span className="ml-1 text-xs opacity-70">· {teamName(team)}</span> : null}
      </Link>)}
    </nav>

    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
      <Card className="p-3 sm:p-4">
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">{selectedTeam?.isMyTeam ? "My roster" : selectedTeam?.ownerName || "League roster"}</p>
            <h2 className="mt-1 truncate text-lg font-bold sm:text-xl">{selectedTeam ? teamName(selectedTeam) : "Roster unavailable"}</h2>
          </div>
          {selectedTeam && <p className="shrink-0 text-sm font-black text-slate-300">{selectedTeam.wins ?? 0}-{selectedTeam.losses ?? 0}{selectedTeam.ties ? `-${selectedTeam.ties}` : ""}</p>}
        </div>
        {players.length
          ? <LeagueRoster players={players} ppgSeason={ppgSeason} />
          : <p className="mt-4 rounded-lg border border-dashed border-slate-700 p-5 text-sm text-slate-400">No player data was returned for this roster. Sync again after Sleeper data is available.</p>}
      </Card>
      <div className="space-y-5">
        <Card>
          <h2 className="font-bold">League format</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-400">Scoring</dt><dd>{Object.keys(league.scoring_settings ?? {}).length ? "Sleeper league scoring" : "PPR fallback"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-400">PPG season</dt><dd>{ppgSeason ? `${ppgSeason} REG` : "Unavailable"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-400">Starter slots</dt><dd className="text-right">{(league.roster_positions ?? []).filter((slot: string) => !["BN", "IR", "TAXI"].includes(slot)).join(" · ") || "—"}</dd></div>
          </dl>
        </Card>
        <Card>
          <h2 className="font-bold">Positional breakdown</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(positionCounts).length
              ? Object.entries(positionCounts).map(([position, count]) => <span key={position} className="rounded bg-slate-800 px-3 py-1 text-sm">{position} <b className="text-cyan-300">{count}</b></span>)
              : <p className="text-sm text-slate-400">Roster unavailable</p>}
          </div>
        </Card>
      </div>
    </div>
  </div>;
}
