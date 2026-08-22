import type { OptimalLineupResult } from "@/lib/player-values/lineup";
import type { SleeperMatchup } from "@/lib/sleeper/types";

export interface LeagueScheduleTeam {
  id: string;
  sleeperRosterId: number;
  name: string;
  isMyTeam: boolean;
}

export interface WeeklyTeamProjection {
  teamId: string;
  week: number;
  lineup: OptimalLineupResult;
  playerProjectedPpg: Record<string, number>;
}

export interface HeadToHeadScheduleRow {
  week: number;
  teamId: string;
  teamName: string;
  opponentId: string;
  opponentName: string;
  projectedScore: number;
  opponentProjectedScore: number;
  projectedMargin: number;
  projectedWinnerId: string | null;
  actualScore: number | null;
  opponentActualScore: number | null;
  completed: boolean;
  lineup: OptimalLineupResult | null;
  opponentLineup: OptimalLineupResult | null;
  lineupPlayerProjectedPpg: Record<string, number>;
  opponentLineupPlayerProjectedPpg: Record<string, number>;
}

export function buildHeadToHeadSchedule(input: {
  teams: LeagueScheduleTeam[];
  matchupRowsByWeek: Map<number, SleeperMatchup[]>;
  projections: WeeklyTeamProjection[];
  currentWeek: number;
  teamId?: string | null;
}) {
  const selected = input.teams.find((team) => team.id === input.teamId)
    ?? input.teams.find((team) => team.isMyTeam)
    ?? input.teams[0];
  if (!selected) return [];
  const teamByRoster = new Map(input.teams.map((team) => [team.sleeperRosterId, team]));
  const projectionByKey = new Map(input.projections.map((row) => [`${row.week}:${row.teamId}`, row]));
  const rows: HeadToHeadScheduleRow[] = [];
  for (let week = 1; week <= 17; week += 1) {
    const matchupRows = input.matchupRowsByWeek.get(week) ?? [];
    const own = matchupRows.find((row) => row.roster_id === selected.sleeperRosterId);
    if (!own || own.matchup_id == null) continue;
    const opponentRow = matchupRows.find((row) => row.matchup_id === own.matchup_id && row.roster_id !== own.roster_id);
    const opponent = opponentRow ? teamByRoster.get(opponentRow.roster_id) : null;
    if (!opponent || !opponentRow) continue;
    const projectionRow = projectionByKey.get(`${week}:${selected.id}`);
    const opponentProjectionRow = projectionByKey.get(`${week}:${opponent.id}`);
    const projection = projectionRow?.lineup ?? null;
    const opponentProjection = opponentProjectionRow?.lineup ?? null;
    const projectedScore = Number(projection?.projectedPpg ?? 0);
    const opponentProjectedScore = Number(opponentProjection?.projectedPpg ?? 0);
    const completed = week < input.currentWeek;
    rows.push({
      week,
      teamId: selected.id,
      teamName: selected.name,
      opponentId: opponent.id,
      opponentName: opponent.name,
      projectedScore,
      opponentProjectedScore,
      projectedMargin: Math.round((projectedScore - opponentProjectedScore) * 10) / 10,
      projectedWinnerId: projectedScore === opponentProjectedScore ? null : projectedScore > opponentProjectedScore ? selected.id : opponent.id,
      actualScore: completed ? Number(own.custom_points ?? own.points ?? 0) : null,
      opponentActualScore: completed ? Number(opponentRow.custom_points ?? opponentRow.points ?? 0) : null,
      completed,
      lineup: projection,
      opponentLineup: opponentProjection,
      lineupPlayerProjectedPpg: projectionRow?.playerProjectedPpg ?? {},
      opponentLineupPlayerProjectedPpg: opponentProjectionRow?.playerProjectedPpg ?? {},
    });
  }
  return rows;
}
