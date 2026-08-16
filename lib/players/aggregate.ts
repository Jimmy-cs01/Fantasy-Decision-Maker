import type { ScoringFormat, SeasonType } from "./types";

export interface WeeklyAggregateInput { season: number; season_type: SeasonType; pass_attempts: number; completions: number; passing_yards: number; passing_touchdowns: number; interceptions: number; rush_attempts: number; rushing_yards: number; rushing_touchdowns: number; targets: number; receptions: number; receiving_yards: number; receiving_touchdowns: number; offense_snaps: number; team_offense_snaps: number; fantasy_points_standard: number; fantasy_points_half_ppr: number; fantasy_points_ppr: number; }

export function aggregateSeasonRows(rows: WeeklyAggregateInput[], scoring: ScoringFormat, season: number, seasonType: SeasonType, position: string) {
  const selected = rows.filter((row) => row.season === season && row.season_type === seasonType);
  const total = (key: keyof WeeklyAggregateInput) => selected.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
  const divide = (numerator: number, denominator: number) => denominator ? numerator / denominator : 0;
  const fantasyField = scoring === "standard" ? "fantasy_points_standard" : scoring === "half_ppr" ? "fantasy_points_half_ppr" : "fantasy_points_ppr";
  const passingYards = total("passing_yards"), rushingYards = total("rushing_yards"), receivingYards = total("receiving_yards");
  const passingTouchdowns = total("passing_touchdowns"), rushingTouchdowns = total("rushing_touchdowns"), receivingTouchdowns = total("receiving_touchdowns");
  const passAttempts = total("pass_attempts"), rushAttempts = total("rush_attempts"), targets = total("targets"), receptions = total("receptions");
  const fantasyPoints = total(fantasyField);
  return { gamesPlayed: selected.length, fantasyPoints, fantasyPointsPerGame: divide(fantasyPoints, selected.length), passingYards, rushingYards, receivingYards, passingTouchdowns, rushingTouchdowns, receivingTouchdowns, interceptionsThrown: passAttempts ? total("interceptions") : 0, totalYards: position === "QB" ? passingYards + rushingYards : rushingYards + receivingYards, totalTouchdowns: position === "QB" ? passingTouchdowns + rushingTouchdowns : rushingTouchdowns + receivingTouchdowns, completionPercentage: divide(total("completions"), passAttempts), yardsPerPassAttempt: divide(passingYards, passAttempts), yardsPerCarry: divide(rushingYards, rushAttempts), yardsPerTarget: divide(receivingYards, targets), yardsPerReception: divide(receivingYards, receptions), snapShare: divide(total("offense_snaps"), total("team_offense_snaps")), trueTouches: rushAttempts + receptions };
}
