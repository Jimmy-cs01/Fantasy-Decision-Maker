import "server-only";
import { assignStarterSlots } from "@/lib/fantasy/roster-order";
import {
  getEphemeralLeagueRosterAnalytics,
  type PlayerIdentity,
  type RosterPlayerRow,
  type RosterRow,
} from "@/lib/player-values/league-service";
import { sleeperClient } from "@/lib/sleeper/client";
import { normalizeLeague, normalizeRoster } from "@/lib/sleeper/service";
import { createClient } from "@/lib/supabase/server";

type DatabaseClient = Awaited<ReturnType<typeof createClient>>;

async function loadCanonicalPlayers(db: DatabaseClient, sleeperIds: string[]) {
  const rows: Array<{
    id: string;
    sleeper_player_id: string | null;
    full_name: string;
    position: string | null;
    team: string | null;
    headshot_url: string | null;
  }> = [];
  for (let start = 0; start < sleeperIds.length; start += 300) {
    const { data, error } = await db
      .from("players")
      .select("id,sleeper_player_id,full_name,position,team,headshot_url")
      .in("sleeper_player_id", sleeperIds.slice(start, start + 300));
    if (error) throw new Error(`Unable to map public Sleeper players: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return new Map(rows.flatMap((row) => row.sleeper_player_id ? [[row.sleeper_player_id, row] as const] : []));
}

export async function loadGuestLeague(username: string, leagueId: string) {
  const sleeperUser = await sleeperClient.getUser(username);
  if (!sleeperUser) throw new Error("Sleeper user was not found.");
  const [league, users, sleeperRosters, sleeperPlayers] = await Promise.all([
    sleeperClient.getLeague(leagueId),
    sleeperClient.getLeagueUsers(leagueId),
    sleeperClient.getRosters(leagueId),
    sleeperClient.getPlayers(),
  ]);
  if (!sleeperRosters.some((roster) => roster.owner_id === sleeperUser.user_id)) {
    throw new Error("That Sleeper league is not connected to this guest username.");
  }

  const db = await createClient();
  const rosteredSleeperIds = [...new Set(sleeperRosters.flatMap((roster) => roster.players ?? []).filter(Boolean))];
  const canonicalBySleeperId = await loadCanonicalPlayers(db, rosteredSleeperIds);
  const normalizedLeague = normalizeLeague(league);
  const memberById = new Map(users.map((user) => [user.user_id, user]));
  const teams = sleeperRosters.map((roster) => {
    const owner = roster.owner_id ? memberById.get(roster.owner_id) : null;
    return {
      id: `guest-team:${leagueId}:${roster.roster_id}`,
      sleeperRosterId: roster.roster_id,
      name: roster.metadata?.team_name || owner?.display_name || owner?.username || `Team ${roster.roster_id}`,
      wins: Number(roster.settings?.wins ?? 0),
      losses: Number(roster.settings?.losses ?? 0),
      ties: Number(roster.settings?.ties ?? 0),
      isMyTeam: roster.owner_id === sleeperUser.user_id,
    };
  });
  const teamByRosterId = new Map(teams.map((team) => [team.sleeperRosterId, team]));
  const rosters: RosterRow[] = [];
  const rosterPlayers: RosterPlayerRow[] = [];

  for (const remote of sleeperRosters) {
    const team = teamByRosterId.get(remote.roster_id);
    if (!team) continue;
    const normalized = normalizeRoster(remote);
    const rosterId = `guest-roster:${leagueId}:${remote.roster_id}`;
    rosters.push({ id: rosterId, fantasy_team_id: team.id, starters: normalized.starter_entries });
    const assignments = assignStarterSlots(normalized.starter_entries, league.roster_positions ?? []);
    for (const sleeperId of normalized.players) {
      const canonical = canonicalBySleeperId.get(sleeperId);
      const remotePlayer = sleeperPlayers[sleeperId];
      const identity: PlayerIdentity = canonical ?? {
        id: `sleeper:${sleeperId}`,
        sleeper_player_id: sleeperId,
        full_name: remotePlayer?.full_name || [remotePlayer?.first_name, remotePlayer?.last_name].filter(Boolean).join(" ") || "Unknown player",
        position: remotePlayer?.position ?? null,
        team: remotePlayer?.team ?? null,
        headshot_url: null,
      };
      const assignment = assignments.get(sleeperId);
      rosterPlayers.push({
        roster_id: rosterId,
        is_starter: Boolean(assignment),
        roster_slot: assignment?.rosterSlot ?? "BN",
        roster_slot_index: assignment?.rosterSlotIndex ?? null,
        players: identity,
      });
    }
  }

  const analytics = await getEphemeralLeagueRosterAnalytics(
    db,
    {
      id: `guest:${leagueId}`,
      total_rosters: normalizedLeague.total_rosters,
      roster_positions: normalizedLeague.roster_positions,
      scoring_settings: normalizedLeague.scoring_settings,
    },
    teams,
    rosters,
    rosterPlayers,
  );

  return {
    league: {
      id: league.league_id,
      name: league.name,
      season: Number(league.season),
      seasonType: league.season_type ?? "regular",
      totalRosters: league.total_rosters ?? teams.length,
      rosterPositions: league.roster_positions ?? [],
      scoringSettings: league.scoring_settings ?? {},
      settings: league.settings ?? {},
    },
    guest: {
      sleeperUserId: sleeperUser.user_id,
      sleeperUsername: sleeperUser.username,
    },
    teams: teams.map((team) => ({
      ...team,
      players: analytics.rostersByTeam.get(team.id) ?? [],
      summary: analytics.teamSummaries.get(team.id) ?? null,
    })),
    analyticsAvailable: analytics.analyticsAvailable,
    projectionSeason: analytics.projectionSeason,
    projectionWeek: analytics.projectionWeek,
  };
}
