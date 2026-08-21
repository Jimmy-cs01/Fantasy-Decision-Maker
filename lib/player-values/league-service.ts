import "server-only";
import { createClient } from "../supabase/server";
import {
  assignStarterSlots,
  normalizeLineupSlot,
  orderRosterPlayers,
} from "../fantasy/roster-order";
import {
  calculateValueContexts,
  getCurrentDepthRoles,
  getLatestProjectionPool,
  getProjectionHistoryRows,
} from "./service";
import { optimizeProjectedLineup } from "./lineup";
import { calculateLeagueSeasonPoints } from "../fantasy/league-scoring";
import type { CombinedPlayerValue, ValueLeagueConfig } from "./types";
import { analyticsErrorDetails, optionalQuery } from "./optional-query";
import { getWeeklyMatchups, matchupContextByTeam } from "../nfl/schedule-service";
import { getInjuriesByPlayerIds } from "../injuries/service";
import { activeGameProjectionPoints, displayedProjectionPoints } from "../projections/presentation";
import { calculateAvailability, availabilityAdjustedQuantile } from "../injuries/availability";
import { expectedGamesRemaining } from "./formula";

type DatabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface LeagueAnalyticsPlayer {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  headshot_url: string | null;
  sleeper_player_id: string | null;
  is_starter: boolean;
  roster_slot: string | null;
  roster_slot_index: number | null;
  projected_ppg: number | null;
  projection_floor: number | null;
  projection_ceiling: number | null;
  last_season_ppg: number | null;
  player_value: number | null;
  position_rank: number | null;
  overall_rank: number | null;
  value_tier: string | null;
  confidence: string | null;
  depth_role: string | null;
  opponent: string | null;
  is_home: boolean | null;
  team_implied_total: number | null;
  active_game_ppg: number | null;
  healthy_player_value: number | null;
  availability_adjustment: number | null;
  injury_status: string | null;
  injury_status_label: string | null;
  injury_timeline: string | null;
  practice_participation: string | null;
  injury_data_stale: boolean;
  current_week_active_probability: number;
}

export interface TeamProjectionSummary {
  fantasyTeamId: string;
  projectedPpg: number | null;
  complete: boolean;
  filledSlots: number;
  requiredSlots: number;
  optimalStarterIds: string[];
}

export interface LeagueInput {
  id: string;
  total_rosters: number | null;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
}

export interface TeamInput {
  id: string;
}

export interface RosterRow {
  id: string;
  fantasy_team_id: string;
  starters: Array<string | null> | null;
}

export interface PlayerIdentity {
  id: string;
  sleeper_player_id: string | null;
  full_name: string;
  position: string | null;
  team: string | null;
  headshot_url: string | null;
}

export interface RosterPlayerRow {
  roster_id: string;
  is_starter: boolean;
  roster_slot: string | null;
  roster_slot_index: number | null;
  players: PlayerIdentity | PlayerIdentity[] | null;
}

export interface LeagueAnalyticsDependencies {
  getLatestProjectionPool: typeof getLatestProjectionPool;
  getProjectionHistoryRows: typeof getProjectionHistoryRows;
  getCurrentDepthRoles: typeof getCurrentDepthRoles;
  getWeeklyMatchups?: typeof getWeeklyMatchups;
  getInjuriesByPlayerIds?: typeof getInjuriesByPlayerIds;
}

const DEFAULT_DEPENDENCIES: LeagueAnalyticsDependencies = {
  getLatestProjectionPool,
  getProjectionHistoryRows,
  getCurrentDepthRoles,
  getWeeklyMatchups,
  getInjuriesByPlayerIds,
};

export async function getLeagueRosterAnalytics(
  db: DatabaseClient,
  league: LeagueInput,
  teams: TeamInput[],
  dependencies: LeagueAnalyticsDependencies = DEFAULT_DEPENDENCIES,
) {
  const teamIds = teams.map((team) => team.id);
  const [{ data: rosterData, error: rosterError }, latest] = await Promise.all([
    db
      .from("rosters")
      .select("id,fantasy_team_id,starters")
      .in("fantasy_team_id", teamIds),
    optionalQuery({
      label: "Projection pool lookup failed",
      fallback: null,
      metadata: { source: "Supabase/player_projections", leagueId: league.id },
      query: (signal) => dependencies.getLatestProjectionPool(db, signal),
    }),
  ]);
  if (rosterError)
    throw new Error(`Unable to load league rosters: ${rosterError.message}`);
  const rosters = (rosterData ?? []) as RosterRow[];
  const rosterIds = rosters.map((roster) => roster.id);
  const { data: rosterPlayersData, error: rosterPlayersError } =
    rosterIds.length
      ? await db
          .from("roster_players")
          .select(
            "roster_id,is_starter,roster_slot,roster_slot_index,players(id,sleeper_player_id,full_name,position,team,headshot_url)",
          )
          .in("roster_id", rosterIds)
      : { data: [], error: null };
  if (rosterPlayersError)
    throw new Error(
      `Unable to load league roster players: ${rosterPlayersError.message}`,
    );

  return hydrateLeagueRosterAnalytics(
    db,
    league,
    teams,
    rosters,
    (rosterPlayersData ?? []) as RosterPlayerRow[],
    dependencies,
    latest,
  );
}

/**
 * Hydrates public Sleeper roster rows without persisting ownership or roster
 * records. It deliberately shares the same projection/value/lineup pipeline as
 * authenticated, database-backed leagues.
 */
export async function getEphemeralLeagueRosterAnalytics(
  db: DatabaseClient,
  league: LeagueInput,
  teams: TeamInput[],
  rosters: RosterRow[],
  rosterPlayers: RosterPlayerRow[],
  dependencies: LeagueAnalyticsDependencies = DEFAULT_DEPENDENCIES,
) {
  const latest = await optionalQuery({
    label: "Guest projection pool lookup failed",
    fallback: null,
    metadata: { source: "Supabase/player_projections", leagueId: league.id },
    query: (signal) => dependencies.getLatestProjectionPool(db, signal),
  });
  return hydrateLeagueRosterAnalytics(
    db,
    league,
    teams,
    rosters,
    rosterPlayers,
    dependencies,
    latest,
  );
}

async function hydrateLeagueRosterAnalytics(
  db: DatabaseClient,
  league: LeagueInput,
  teams: TeamInput[],
  rosters: RosterRow[],
  rosterPlayersData: RosterPlayerRow[],
  dependencies: LeagueAnalyticsDependencies,
  latest: Awaited<ReturnType<typeof getLatestProjectionPool>>,
) {

  const scoringSettings = Object.keys(league.scoring_settings ?? {}).length
    ? league.scoring_settings!
    : { rec: 1 };
  const leagueConfig: ValueLeagueConfig = {
    teams: Number(league.total_rosters ?? (teams.length || 10)),
    rosterPositions: league.roster_positions ?? [],
    scoringSettings,
  };
  const rosteredPlayerIds = [
    ...new Set(
      rosterPlayersData.flatMap((entry) => {
        const identity = Array.isArray(entry.players)
          ? entry.players[0]
          : entry.players;
        return identity?.id ? [identity.id] : [];
      }),
    ),
  ];
  const playerIds = latest ? rosteredPlayerIds : [];
  const [history, depthRoles, matchups, injuries] = latest
    ? await Promise.all([
        optionalQuery({
          label: "League projection history lookup failed",
          fallback: [],
          metadata: {
            source: "Supabase/player_value_season_history",
            leagueId: league.id,
            season: latest.season,
          },
          query: async () =>
            dependencies.getProjectionHistoryRows(db, playerIds, latest.season),
        }),
        optionalQuery({
          label: "League depth chart lookup failed",
          fallback: new Map(),
          metadata: {
            source: "Supabase/player_depth_chart_roles",
            leagueId: league.id,
            season: latest.season,
          },
          query: async () =>
            dependencies.getCurrentDepthRoles(db, playerIds, latest.season, {
              leagueId: league.id,
            }),
        }),
        optionalQuery({
          label: "League matchup context lookup failed",
          fallback: [],
          metadata: { source: "Supabase/nfl_games+odds_games_consensus", leagueId: league.id, season: latest.season, week: latest.week },
          query: async () => (dependencies.getWeeklyMatchups ?? getWeeklyMatchups)(db, latest.season, latest.week),
        }),
        dependencies.getInjuriesByPlayerIds
          ? optionalQuery({
              label: "League injury lookup failed",
              fallback: new Map(),
              metadata: { source: "Supabase/player_injuries", leagueId: league.id },
              query: async () => dependencies.getInjuriesByPlayerIds!(db, playerIds),
            })
          : Promise.resolve(new Map()),
      ])
    : [[], new Map(), [], new Map()];
  const matchupByTeam = matchupContextByTeam(matchups);
  const kickoffByTeam = new Map([...matchupByTeam].map(([team, matchup]) => [team, matchup.kickoff]));
  const projectionByPlayerId = new Map((latest?.records ?? []).map((record) => [record.player_id, record]));
  let valueContexts = null;
  if (latest) {
    try {
      valueContexts = calculateValueContexts(
        latest.records,
        latest.week,
        leagueConfig,
        history,
        depthRoles,
        injuries,
        kickoffByTeam,
      );
    } catch (error) {
      console.warn(
        "Player Value calculation failed; league rosters will continue without analytics.",
        {
          leagueId: league.id,
          ...analyticsErrorDetails(error),
        },
      );
    }
  }
  const values =
    valueContexts?.byPlayerId ?? new Map<string, CombinedPlayerValue>();
  const priorSeason = (latest?.season ?? 0) - 1;
  const lastSeasonPpgByPlayerId = new Map(
    history
      .filter(
        (row) => row.season === priorSeason && Number(row.games_played) > 0,
      )
      .map((row) => [
        row.player_id,
        calculateLeagueSeasonPoints(row, scoringSettings) /
          Number(row.games_played),
      ]),
  );
  const entriesByRoster = new Map<string, RosterPlayerRow[]>();
  for (const entry of rosterPlayersData) {
    entriesByRoster.set(entry.roster_id, [
      ...(entriesByRoster.get(entry.roster_id) ?? []),
      entry,
    ]);
  }

  const rostersByTeam = new Map<string, LeagueAnalyticsPlayer[]>();
  const teamSummaries = new Map<string, TeamProjectionSummary>();
  for (const roster of rosters) {
    const fallbackAssignments = assignStarterSlots(
      roster.starters ?? [],
      league.roster_positions ?? [],
    );
    const players = (entriesByRoster.get(roster.id) ?? []).flatMap(
      (entry): LeagueAnalyticsPlayer[] => {
        const identity = Array.isArray(entry.players)
          ? entry.players[0]
          : entry.players;
        if (!identity) return [];
        const storedSlot = normalizeLineupSlot(entry.roster_slot);
        const fallback = identity.sleeper_player_id
          ? fallbackAssignments.get(identity.sleeper_player_id)
          : undefined;
        const useFallback =
          entry.is_starter &&
          (!storedSlot || ["STARTER", "BN", "BENCH"].includes(storedSlot));
        const playerValue = values.get(identity.id)?.league;
        const scoredProjection = valueContexts?.leagueProjections.get(identity.id)
          ?? valueContexts?.generalProjections.get(identity.id);
        const projectionRecord = projectionByPlayerId.get(identity.id);
        const availability = latest ? calculateAvailability(injuries.get(identity.id), expectedGamesRemaining(latest.week), new Date(), identity.team ? kickoffByTeam.get(identity.team) : null) : null;
        const activeDisplayPpg = projectionRecord ? activeGameProjectionPoints({ stats: projectionRecord.projected_stats, position: identity.position, mode: "league", leagueSettings: scoringSettings }) : null;
        const displayPpg = projectionRecord ? displayedProjectionPoints({ stats: projectionRecord.projected_stats, position: identity.position, mode: "league", leagueSettings: scoringSettings, availability }) : null;
        const activeFloor = activeDisplayPpg != null && projectionRecord ? Math.max(0, activeDisplayPpg + Number(projectionRecord.residual_low)) : null;
        const activeCeiling = activeDisplayPpg != null && projectionRecord ? Math.max(0, activeDisplayPpg + Number(projectionRecord.residual_high)) : null;
        const matchup = identity.team ? matchupByTeam.get(identity.team) : null;
        return [
          {
            ...identity,
            is_starter: entry.is_starter,
            roster_slot: useFallback
              ? (fallback?.rosterSlot ?? entry.roster_slot)
              : entry.roster_slot,
            roster_slot_index: useFallback
              ? (fallback?.rosterSlotIndex ?? entry.roster_slot_index)
              : entry.roster_slot_index,
            projected_ppg: displayPpg,
            projection_floor: activeFloor != null && activeDisplayPpg != null ? availabilityAdjustedQuantile(0.2, availability, activeFloor, activeDisplayPpg, activeCeiling!) : scoredProjection?.floorPpg ?? null,
            projection_ceiling: activeCeiling != null && activeDisplayPpg != null ? availabilityAdjustedQuantile(0.8, availability, activeFloor!, activeDisplayPpg, activeCeiling) : scoredProjection?.ceilingPpg ?? null,
            last_season_ppg: lastSeasonPpgByPlayerId.get(identity.id) ?? null,
            player_value: playerValue?.value ?? null,
            position_rank: playerValue?.positionRank ?? null,
            overall_rank: playerValue?.overallRank ?? null,
            value_tier: playerValue?.tier ?? null,
            confidence: playerValue?.confidence ?? null,
            depth_role: playerValue?.depthRole ?? null,
            opponent: matchup?.opponent ?? null,
            is_home: matchup?.isHome ?? null,
            team_implied_total: matchup?.teamImpliedTotal ?? null,
            active_game_ppg: activeDisplayPpg,
            healthy_player_value: playerValue?.healthyValue ?? null,
            availability_adjustment: playerValue?.availabilityAdjustment ?? null,
            injury_status: playerValue?.injuryStatus ?? null,
            injury_status_label: playerValue?.injuryStatusLabel ?? null,
            injury_timeline: playerValue?.injuryTimeline ?? null,
            practice_participation: playerValue?.practiceParticipation ?? null,
            injury_data_stale: playerValue?.injuryDataStale ?? false,
            current_week_active_probability: playerValue?.currentWeekActiveProbability ?? 1,
          },
        ];
      },
    );
    const ordered = orderRosterPlayers(players);
    rostersByTeam.set(roster.fantasy_team_id, ordered);
    const optimal = optimizeProjectedLineup(
      ordered.map((player) => ({
        playerId: player.id,
        position: player.position,
        projectedPpg: player.projected_ppg,
      })),
      league.roster_positions ?? [],
    );
    teamSummaries.set(roster.fantasy_team_id, {
      fantasyTeamId: roster.fantasy_team_id,
      projectedPpg: optimal.filledSlots ? optimal.projectedPpg : null,
      complete: optimal.complete,
      filledSlots: optimal.filledSlots,
      requiredSlots: optimal.requiredSlots,
      optimalStarterIds: optimal.selectedPlayerIds,
    });
  }
  return {
    rostersByTeam,
    teamSummaries,
    projectionSeason: latest?.season ?? null,
    projectionWeek: latest?.week ?? null,
    valuesByPlayerId: values,
    generalProfiles: valueContexts?.general.profiles ?? null,
    leagueProfiles: valueContexts?.league?.profiles ?? null,
    analyticsAvailable: Boolean(valueContexts),
  };
}
