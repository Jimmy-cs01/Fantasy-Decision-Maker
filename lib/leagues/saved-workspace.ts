import "server-only";
import { getLeagueRosterAnalytics } from "@/lib/player-values/league-service";
import type { createClient } from "@/lib/supabase/server";

type DatabaseClient = Awaited<ReturnType<typeof createClient>>;

export async function loadSavedSleeperWorkspace(
  db: DatabaseClient,
  userId: string,
  requestedLeagueId?: string | null,
) {
  const { data: leagues, error: leaguesError } = await db.from("leagues")
    .select("*").eq("owner_id", userId).eq("provider", "sleeper")
    .not("last_synced_at", "is", null).order("last_synced_at", { ascending: false });
  if (leaguesError) throw new Error(`Unable to load Sleeper leagues: ${leaguesError.message}`);
  const league = leagues?.find((item) => item.id === requestedLeagueId) ?? leagues?.[0] ?? null;
  if (!league) return { leagues: leagues ?? [], league: null, teams: [], analytics: null };
  const [{ data: teamRows, error: teamsError }, { data: members }, { data: account }] = await Promise.all([
    db.from("fantasy_teams").select("id,name,wins,losses,ties,league_member_id,sleeper_roster_id,provider_team_id,provider_metadata").eq("league_id", league.id).order("sleeper_roster_id"),
    db.from("league_members").select("id,sleeper_user_id,username,display_name").eq("league_id", league.id),
    db.from("sleeper_accounts").select("sleeper_user_id,username").eq("user_id", userId).limit(1).maybeSingle(),
  ]);
  if (teamsError) throw new Error(`Unable to load league teams: ${teamsError.message}`);
  const memberById = new Map((members ?? []).map((member) => [member.id, member]));
  const personalMemberId = members?.find((member) => member.sleeper_user_id === account?.sleeper_user_id)?.id ?? null;
  const teams = (teamRows ?? []).map((team) => ({
    ...team,
    sleeperRosterId: Number(team.sleeper_roster_id ?? team.provider_team_id),
    name: team.name || (team.league_member_id ? memberById.get(team.league_member_id)?.display_name || memberById.get(team.league_member_id)?.username : null) || `Team ${team.sleeper_roster_id ?? team.provider_team_id}`,
    isMyTeam: team.league_member_id === personalMemberId || team.provider_metadata?.is_user_team === true,
  }));
  const analytics = await getLeagueRosterAnalytics(db, league, teams);
  return {
    leagues: leagues ?? [],
    league,
    teams: teams.map((team) => ({ ...team, players: analytics.rostersByTeam.get(team.id) ?? [] })),
    analytics,
    sleeperAccount: account,
  };
}
