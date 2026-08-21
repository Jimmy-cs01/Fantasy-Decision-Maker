import "server-only";
import { calculateProjectedFantasyPoints } from "../projections/scoring";
import { projectionIdentity } from "../player-values/projections";
import { getCurrentDepthRoles, getLatestProjectionPool } from "../player-values/service";
import { getWeeklyMatchups, matchupContextByTeam } from "../nfl/schedule-service";
import { optionalQuery } from "../player-values/optional-query";
import type { StartSitCandidate } from "./decision";
import { getInjuriesByPlayerIds } from "../injuries/service";
import { calculateAvailability, availabilityAdjustedPpg, availabilityAdjustedQuantile } from "../injuries/availability";
import { expectedGamesRemaining } from "../player-values/formula";

type DatabaseClient = Parameters<typeof getLatestProjectionPool>[0];

export interface StartSitPlayer extends StartSitCandidate {
  headshotUrl: string | null;
  nflTeam: string | null;
}

export async function getStartSitProjectionPool(
  db: DatabaseClient,
  scoringSettings: Record<string, number>,
): Promise<{ players: StartSitPlayer[]; season: number | null; week: number | null }> {
  const latest = await getLatestProjectionPool(db);
  if (!latest) return { players: [], season: null, week: null };
  const ids = latest.records.map((record) => record.player_id);
  const [depthRoles, matchups, injuries] = await Promise.all([
    getCurrentDepthRoles(db, ids, latest.season),
    optionalQuery({
      label: "Start / Sit matchup lookup failed",
      fallback: [],
      metadata: { source: "Supabase/nfl_games", season: latest.season, week: latest.week },
      query: () => getWeeklyMatchups(db, latest.season, latest.week),
    }),
    getInjuriesByPlayerIds(db, ids),
  ]);
  const matchupByTeam = matchupContextByTeam(matchups);
  const players = latest.records.flatMap((record): StartSitPlayer[] => {
    const identity = projectionIdentity(record);
    const position = (identity?.sleeper_position ?? identity?.position ?? identity?.historical_position)?.toUpperCase();
    if (!identity || !position || !["QB", "RB", "WR", "TE", "K"].includes(position)) return [];
    const projectedPpg = calculateProjectedFantasyPoints(record.projected_stats, scoringSettings, position);
    const activeFloor = Math.max(0, projectedPpg + Number(record.residual_low));
    const activeCeiling = Math.max(0, projectedPpg + Number(record.residual_high));
    const depth = depthRoles.get(record.player_id);
    const matchup = identity.team ? matchupByTeam.get(identity.team) : null;
    const availability = calculateAvailability(injuries.get(record.player_id), expectedGamesRemaining(latest.week), new Date(), matchup?.kickoff);
    return [{
      id: record.player_id,
      name: identity.full_name,
      position,
      nflTeam: identity.team,
      headshotUrl: identity.headshot_url,
      projectedPpg: availabilityAdjustedPpg(projectedPpg, availability),
      activeGamePpg: projectedPpg,
      floor: availabilityAdjustedQuantile(0.2, availability, activeFloor, projectedPpg, activeCeiling),
      ceiling: availabilityAdjustedQuantile(0.8, availability, activeFloor, projectedPpg, activeCeiling),
      injuryStatus: availability.status,
      injuryTimeline: availability.timelineLabel,
      practiceParticipation: availability.practiceParticipation,
      activeProbability: availability.currentWeekActiveProbability,
      confidence: record.confidence,
      depthRole: depth ? `${depth.depthPosition}${depth.depthRank}` : null,
      opponent: matchup?.opponent ?? null,
      isHome: matchup?.isHome ?? null,
      teamImpliedTotal: matchup?.teamImpliedTotal ?? null,
    }];
  }).sort((left, right) => Number(right.projectedPpg) - Number(left.projectedPpg) || left.name.localeCompare(right.name));
  return { players, season: latest.season, week: latest.week };
}
