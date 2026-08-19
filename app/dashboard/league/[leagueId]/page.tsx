import { notFound } from "next/navigation";
import { LeagueOverview } from "@/components/dashboard/league-overview";
import { Button } from "@/components/ui/button";
import { getLeagueRosterAnalytics } from "@/lib/player-values/league-service";
import { createClient } from "@/lib/supabase/server";
import { syncLeague } from "../../actions";

const first = (input: string | string[] | undefined) =>
  Array.isArray(input) ? input[0] : input;

export default async function LeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ leagueId }, query] = await Promise.all([params, searchParams]);
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const { data: league } = await db
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .eq("owner_id", user!.id)
    .maybeSingle();
  if (!league) notFound();

  const [{ data: teamsData }, { data: members }, { data: account }] =
    await Promise.all([
      db
        .from("fantasy_teams")
        .select("id,name,wins,losses,ties,league_member_id,sleeper_roster_id,provider_team_id,provider_metadata")
        .eq("league_id", league.id)
        .order("provider_team_id"),
      db
        .from("league_members")
        .select("id,sleeper_user_id,username,display_name")
        .eq("league_id", league.id),
      db
        .from("sleeper_accounts")
        .select("sleeper_user_id")
        .eq("user_id", user!.id)
        .limit(1)
        .maybeSingle(),
    ]);
  const personalMemberId =
    (members ?? []).find(
      (member) => member.sleeper_user_id === account?.sleeper_user_id,
    )?.id ?? null;
  const membersById = new Map(
    (members ?? []).map((member) => [member.id, member]),
  );
  const teams = (teamsData ?? []).map((team) => {
    const owner = team.league_member_id
      ? membersById.get(team.league_member_id)
      : null;
    return {
      ...team,
      ownerName: owner?.display_name || owner?.username || null,
      isMyTeam: team.league_member_id === personalMemberId || team.provider_metadata?.is_user_team === true,
    };
  });
  let analytics: Awaited<ReturnType<typeof getLeagueRosterAnalytics>> | null =
    null;
  let rosterLoadFailed = false;
  try {
    analytics = await getLeagueRosterAnalytics(db, league, teams);
  } catch (error) {
    rosterLoadFailed = true;
    console.error("Unable to load league projection analytics", error);
  }
  const projectionLabel =
    analytics?.projectionSeason && analytics.projectionWeek
      ? `${analytics.projectionSeason} W${analytics.projectionWeek}`
      : null;

  const teamName = (team: (typeof teams)[number]) =>
    team.name || team.ownerName || `Team ${team.provider_team_id ?? team.sleeper_roster_id ?? "—"}`;

  return <LeagueOverview
    league={{
      id: league.id, name: league.name, season: league.season,
      seasonType: league.season_type, totalRosters: league.total_rosters ?? teams.length,
      provider: league.provider, rosterPositions: league.roster_positions ?? [],
      scoringAvailable: Object.keys(league.scoring_settings ?? {}).length > 0,
      lastSyncedAt: league.last_synced_at,
    }}
    teams={teams.map((team) => ({
      id: team.id, displayName: teamName(team), ownerName: team.ownerName,
      wins: Number(team.wins ?? 0), losses: Number(team.losses ?? 0), ties: Number(team.ties ?? 0),
      isMyTeam: team.isMyTeam, players: analytics?.rostersByTeam.get(team.id) ?? [],
      summary: analytics?.teamSummaries.get(team.id) ?? null,
    }))}
    selectedTeamId={first(query.teamId)}
    teamHref={(teamId) => `/dashboard/league/${league.id}?teamId=${teamId}`}
    projectionLabel={projectionLabel}
    rosterLoadFailed={rosterLoadFailed}
    headerAction={<form action={syncLeague}>
          <input type="hidden" name="leagueId" value={league.id} />
          <Button>Sync League</Button>
        </form>}
  />;
}
