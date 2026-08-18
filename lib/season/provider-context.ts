import "server-only";
import { cache } from "react";
import { sleeperClient } from "../sleeper/client";

export interface ProviderSeasonContext {
  regularSeasonWeeks: number;
  playoffTeams: number;
  pointsForByExternalTeam: Map<string, number>;
  allPlayWinPctByExternalTeam: Map<string, number>;
  remainingMatchups: Array<{ week: number; externalTeamA: string; externalTeamB: string }>;
  scheduleAvailable: boolean;
  warnings: string[];
}

export const getSleeperSeasonContext = cache(async (leagueId: string, completedWeeks: number): Promise<ProviderSeasonContext> => {
  const league = await sleeperClient.getLeague(leagueId);
  const regularSeasonWeeks = Math.max(1, Number(league.settings?.playoff_week_start ?? 15) - 1);
  const playoffTeams = Math.max(1, Number(league.settings?.playoff_teams ?? (Number(league.total_rosters ?? 10) >= 10 ? 6 : 4)));
  const weekResults = await Promise.allSettled(Array.from({ length: regularSeasonWeeks }, (_, index) => sleeperClient.getMatchups(leagueId, index + 1)));
  const pointsForByExternalTeam = new Map<string, number>();
  const allPlay = new Map<string, { wins: number; comparisons: number }>();
  const remainingMatchups: ProviderSeasonContext["remainingMatchups"] = [];
  const warnings: string[] = [];
  weekResults.forEach((result, index) => {
    const week = index + 1;
    if (result.status === "rejected") { warnings.push(`Week ${week} matchup data unavailable`); return; }
    const rows = result.value;
    if (week <= completedWeeks) {
      for (const row of rows) pointsForByExternalTeam.set(String(row.roster_id), (pointsForByExternalTeam.get(String(row.roster_id)) ?? 0) + Number(row.custom_points ?? row.points ?? 0));
      for (const row of rows) {
        const score = Number(row.custom_points ?? row.points ?? 0);
        const opponents = rows.filter((other) => other.roster_id !== row.roster_id);
        const record = allPlay.get(String(row.roster_id)) ?? { wins: 0, comparisons: 0 };
        for (const opponent of opponents) { const other = Number(opponent.custom_points ?? opponent.points ?? 0); record.wins += score > other ? 1 : score === other ? 0.5 : 0; record.comparisons += 1; }
        allPlay.set(String(row.roster_id), record);
      }
    } else {
      const groups = new Map<number, typeof rows>();
      for (const row of rows) if (row.matchup_id != null) groups.set(row.matchup_id, [...(groups.get(row.matchup_id) ?? []), row]);
      for (const group of groups.values()) if (group.length === 2) remainingMatchups.push({ week, externalTeamA: String(group[0].roster_id), externalTeamB: String(group[1].roster_id) });
    }
  });
  return {
    regularSeasonWeeks,
    playoffTeams,
    pointsForByExternalTeam,
    allPlayWinPctByExternalTeam: new Map([...allPlay].map(([id, record]) => [id, record.comparisons ? record.wins / record.comparisons : 0.5])),
    remainingMatchups,
    scheduleAvailable: remainingMatchups.length > 0,
    warnings,
  };
});
