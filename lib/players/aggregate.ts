import type { ScoringFormat, SeasonType } from "./types";

export interface WeeklyAggregateInput { season_type: SeasonType; fantasy_points_standard: number; fantasy_points_half_ppr: number; fantasy_points_ppr: number; total_yards: number; total_touchdowns: number; targets: number; receptions: number; touches: number; }

export function aggregateSeasonRows(rows: WeeklyAggregateInput[], scoring: ScoringFormat, seasonType: SeasonType) {
  const selected = rows.filter((row) => row.season_type === seasonType);
  const field = scoring === "standard" ? "fantasy_points_standard" : scoring === "half_ppr" ? "fantasy_points_half_ppr" : "fantasy_points_ppr";
  const total = (key: keyof WeeklyAggregateInput) => selected.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const fantasyPoints = total(field);
  return { gamesPlayed: selected.length, fantasyPoints, fantasyPointsPerGame: selected.length ? fantasyPoints / selected.length : 0, totalYards: total("total_yards"), totalTouchdowns: total("total_touchdowns"), targets: total("targets"), receptions: total("receptions"), touches: total("touches") };
}
