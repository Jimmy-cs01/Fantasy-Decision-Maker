import Link from "next/link";
import { TradeFinder, type TradeTeam } from "@/components/trades/trade-finder";
import { Card } from "@/components/ui/card";
import { getLeagueRosterAnalytics } from "@/lib/player-values/league-service";
import { createClient } from "@/lib/supabase/server";

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const { data: leagues, error: leaguesError } = await db
    .from("leagues")
    .select("*")
    .eq("owner_id", user!.id)
    .not("last_synced_at", "is", null)
    .order("last_synced_at", { ascending: false });
  if (leaguesError)
    throw new Error(
      "Unable to load synchronized leagues: " + leaguesError.message,
    );
  const league =
    leagues?.find((item) => item.id === first(query.leagueId)) ??
    leagues?.[0] ??
    null;
  if (!league)
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-black">Trade Finder</h1>
        <Card className="mt-5 text-center">
          <h2 className="font-bold">Connect a league first</h2>
          <p className="mt-2 text-slate-400">
            Trade Finder only uses players from synchronized Sleeper rosters.
          </p>
          <Link
            href="/dashboard/connect"
            className="mt-4 inline-block font-bold text-cyan-300"
          >
            Connect Sleeper →
          </Link>
        </Card>
      </div>
    );
  const [
    { data: teamRows, error: teamsError },
    { data: members, error: membersError },
    { data: account, error: accountError },
  ] = await Promise.all([
    db
      .from("fantasy_teams")
      .select("id,name,league_member_id,sleeper_roster_id")
      .eq("league_id", league.id)
      .order("sleeper_roster_id"),
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
  if (teamsError)
    throw new Error("Unable to load league teams: " + teamsError.message);
  if (membersError)
    throw new Error("Unable to load league members: " + membersError.message);
  if (accountError)
    throw new Error(
      "Unable to resolve the connected Sleeper account: " +
        accountError.message,
    );
  const personalMemberId =
    members?.find(
      (member) => member.sleeper_user_id === account?.sleeper_user_id,
    )?.id ?? null;
  const membersById = new Map(
    (members ?? []).map((member) => [member.id, member]),
  );
  const teams = (teamRows ?? []).map((team) => ({
    ...team,
    isMyTeam: team.league_member_id === personalMemberId,
  }));
  const analytics = await getLeagueRosterAnalytics(db, league, teams);
  const tradeTeams: TradeTeam[] = teams.map((team) => {
    const member = team.league_member_id
      ? membersById.get(team.league_member_id)
      : null;
    return {
      id: team.id,
      name: team.isMyTeam
        ? "My Team"
        : team.name ||
          member?.display_name ||
          member?.username ||
          `Team ${team.sleeper_roster_id}`,
      isMyTeam: team.isMyTeam,
      players: (analytics.rostersByTeam.get(team.id) ?? []).map((player) => ({
        id: player.id,
        teamId: team.id,
        name: player.full_name,
        position: player.position,
        nflTeam: player.team,
        headshotUrl: player.headshot_url,
        value: player.player_value,
        projectedPpg: player.projected_ppg,
        lastSeasonPpg: player.last_season_ppg,
        opponent: player.opponent,
        isHome: player.is_home,
        teamImpliedTotal: player.team_implied_total,
      })),
    };
  });
  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <p className="text-xs font-black tracking-[0.2em] text-cyan-300">
          LEAGUE ANALYTICS
        </p>
        <h1 className="mt-1 text-3xl font-black">Trade Finder</h1>
        <p className="mt-2 text-sm text-slate-400">
          Build a trade or search close-value packages using {league.name}
          &apos;s scoring, roster demand, and projected lineups.
        </p>
      </header>
      <nav className="mt-4 flex gap-2 overflow-x-auto">
        {leagues?.map((item) => (
          <Link
            key={item.id}
            href={`/trades?leagueId=${item.id}`}
            className={`rounded-full border px-3 py-2 text-sm font-bold ${item.id === league.id ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 text-slate-400"}`}
          >
            {item.name}
          </Link>
        ))}
      </nav>
      <div className="mt-5">
        <TradeFinder
          teams={tradeTeams}
          rosterPositions={league.roster_positions ?? []}
          analyticsAvailable={analytics.analyticsAvailable}
          leagueTeams={Number(league.total_rosters ?? teams.length ?? 10)}
        />
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Searches the top 12 rostered assets per team, including bounded 2-for-3
        packages, before simulating both optimized lineups. It does not
        estimate acceptance probability.
      </p>
    </div>
  );
}
