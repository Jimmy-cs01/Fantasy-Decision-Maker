import { calculateLeagueSeasonPoints, type SleeperScoringSettings } from "../fantasy/league-scoring";
import type { ProjectedStatLine, ProjectionScoringMode } from "./types";

const value = (input: unknown) => {
  const numeric = Number(input ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

export function calculateProjectedStandardPoints(stats: ProjectedStatLine) {
  return Math.round((
    value(stats.passing_yards) * 0.04
    + value(stats.passing_touchdowns) * 4
    - value(stats.interceptions_thrown) * 2
    + value(stats.rushing_yards) * 0.1
    + value(stats.rushing_touchdowns) * 6
    + value(stats.receiving_yards) * 0.1
    + value(stats.receiving_touchdowns) * 6
  ) * 100) / 100;
}

export function scoringSettingsForMode(mode: Exclude<ProjectionScoringMode, "league">): SleeperScoringSettings {
  if (mode === "half_ppr") return { rec: 0.5 };
  if (mode === "ppr") return { rec: 1 };
  return { rec: 0 };
}

export function calculateProjectedFantasyPoints(
  stats: ProjectedStatLine,
  settings: SleeperScoringSettings,
  position?: string | null,
) {
  return calculateLeagueSeasonPoints({
    ...stats,
    historical_position: position,
    fantasy_points_standard: calculateProjectedStandardPoints(stats),
  }, settings);
}
