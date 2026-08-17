import Link from "next/link";
import { notFound } from "next/navigation";
import { LeagueRoster } from "@/components/dashboard/league-roster";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { selectLeagueTeam } from "@/lib/fantasy/roster-order";
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
        .select("id,name,wins,losses,ties,league_member_id,sleeper_roster_id")
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
      isMyTeam: team.league_member_id === personalMemberId,
    };
  });
  const selectedTeam = selectLeagueTeam(
    teams,
    first(query.teamId) ?? null,
    personalMemberId,
  );
  let analytics: Awaited<ReturnType<typeof getLeagueRosterAnalytics>> | null =
    null;
  let rosterLoadFailed = false;
  try {
    analytics = await getLeagueRosterAnalytics(db, league, teams);
  } catch (error) {
    rosterLoadFailed = true;
    console.error("Unable to load league projection analytics", error);
  }
  const players = selectedTeam
    ? (analytics?.rostersByTeam.get(selectedTeam.id) ?? [])
    : [];
  const selectedTeamProjection = selectedTeam
    ? (analytics?.teamSummaries.get(selectedTeam.id) ?? null)
    : null;
  const projectionLabel =
    analytics?.projectionSeason && analytics.projectionWeek
      ? `${analytics.projectionSeason} W${analytics.projectionWeek}`
      : null;

  const positionCounts = players.reduce<Record<string, number>>(
    (counts, player) => {
      const key = player.position || "Other";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const teamName = (team: (typeof teams)[number]) =>
    team.name || team.ownerName || `Team ${team.sleeper_roster_id}`;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black tracking-[0.2em] text-cyan-300">
            LEAGUE OVERVIEW
          </p>
          <h1 className="mt-1 text-2xl font-black sm:text-3xl">
            {league.name}
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {league.season} · {league.season_type ?? "regular"} ·{" "}
            {league.total_rosters ?? teams.length} teams
          </p>
        </div>
        <form action={syncLeague}>
          <input type="hidden" name="leagueId" value={league.id} />
          <Button>Sync League</Button>
        </form>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Last synchronization:{" "}
        {league.last_synced_at
          ? new Date(league.last_synced_at).toLocaleString()
          : "Not yet synced"}
      </p>

      <nav
        aria-label="League teams"
        className="mt-5 flex [scrollbar-width:none] gap-2 overflow-x-auto pb-2"
      >
        {teams.map((team) => (
          <Link
            key={team.id}
            href={`/dashboard/league/${league.id}?teamId=${team.id}`}
            aria-current={selectedTeam?.id === team.id ? "page" : undefined}
            className={`min-w-max rounded-full border px-3.5 py-2 text-sm font-bold transition ${selectedTeam?.id === team.id ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-slate-800 bg-slate-900 text-slate-400 hover:text-white"}`}
          >
            <span>
              {team.isMyTeam ? "My Team" : teamName(team)}
              {team.isMyTeam && teamName(team) !== "My Team" ? (
                <span className="ml-1 text-xs opacity-70">
                  · {teamName(team)}
                </span>
              ) : null}
            </span>
            {analytics?.teamSummaries.get(team.id)?.projectedPpg != null && (
              <span className="ml-2 text-xs text-cyan-300 tabular-nums">
                {analytics.teamSummaries.get(team.id)!.projectedPpg!.toFixed(1)}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
        <Card className="p-3 sm:p-4">
          <div className="flex items-end justify-between gap-3 px-1">
            <div className="min-w-0">
              <p className="text-[10px] font-black tracking-[0.2em] text-cyan-300 uppercase">
                {selectedTeam?.isMyTeam
                  ? "My roster"
                  : selectedTeam?.ownerName || "League roster"}
              </p>
              <h2 className="mt-1 truncate text-lg font-bold sm:text-xl">
                {selectedTeam ? teamName(selectedTeam) : "Roster unavailable"}
              </h2>
            </div>
            {selectedTeam && (
              <div className="shrink-0 text-right">
                <p className="text-sm font-black text-slate-300">
                  {selectedTeam.wins ?? 0}-{selectedTeam.losses ?? 0}
                  {selectedTeam.ties ? `-${selectedTeam.ties}` : ""}
                </p>
                {selectedTeamProjection?.projectedPpg != null && (
                  <p className="mt-1 text-xs font-bold text-cyan-300">
                    {selectedTeamProjection.projectedPpg.toFixed(1)} projected
                    PPG{selectedTeamProjection.complete ? "" : " · partial"}
                  </p>
                )}
              </div>
            )}
          </div>
          {players.length ? (
            <LeagueRoster
              players={players}
              projectionLabel={projectionLabel}
              leagueId={league.id}
            />
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-slate-700 p-5 text-sm text-slate-400">
              {rosterLoadFailed
                ? "Roster data is temporarily unavailable. Your synchronized league is still connected; please retry this page."
                : "No player data was returned for this roster. Sync again after Sleeper data is available."}
            </p>
          )}
        </Card>
        <div className="space-y-5">
          <Card>
            <h2 className="font-bold">League format</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Scoring</dt>
                <dd>
                  {Object.keys(league.scoring_settings ?? {}).length
                    ? "Sleeper league scoring"
                    : "PPR fallback"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Projection</dt>
                <dd>{projectionLabel ?? "Unavailable"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Optimal lineup</dt>
                <dd>
                  {selectedTeamProjection
                    ? `${selectedTeamProjection.filledSlots}/${selectedTeamProjection.requiredSlots} slots`
                    : "Unavailable"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Starter slots</dt>
                <dd className="text-right">
                  {(league.roster_positions ?? [])
                    .filter(
                      (slot: string) => !["BN", "IR", "TAXI"].includes(slot),
                    )
                    .join(" · ") || "—"}
                </dd>
              </div>
            </dl>
          </Card>
          <Card>
            <h2 className="font-bold">Positional breakdown</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(positionCounts).length ? (
                Object.entries(positionCounts).map(([position, count]) => (
                  <span
                    key={position}
                    className="rounded bg-slate-800 px-3 py-1 text-sm"
                  >
                    {position} <b className="text-cyan-300">{count}</b>
                  </span>
                ))
              ) : (
                <p className="text-sm text-slate-400">Roster unavailable</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
