import type { LeaderSort, PlayerSeasonRow, PositionFilter, ScoringFormat } from "./types";

export const SCORING_COLUMNS: Record<ScoringFormat, { points: keyof PlayerSeasonRow; ppg: keyof PlayerSeasonRow; label: string }> = {
  standard: { points: "fantasy_points_standard", ppg: "fantasy_points_standard_per_game", label: "Standard" },
  half_ppr: { points: "fantasy_points_half_ppr", ppg: "fantasy_points_half_ppr_per_game", label: "Half PPR" },
  ppr: { points: "fantasy_points_ppr", ppg: "fantasy_points_ppr_per_game", label: "PPR" },
};

export const SORT_COLUMNS: Record<LeaderSort, keyof PlayerSeasonRow> = {
  points: "fantasy_points_ppr", ppg: "fantasy_points_ppr_per_game", yards: "total_yards", tds: "total_touchdowns",
  targets: "targets", touches: "touches", receptions: "receptions", receiving_yards: "receiving_yards",
  rushing_yards: "rushing_yards", passing_yards: "passing_yards",
};

export function scoringSortColumn(sort: LeaderSort, scoring: ScoringFormat): keyof PlayerSeasonRow {
  if (sort === "points") return SCORING_COLUMNS[scoring].points;
  if (sort === "ppg") return SCORING_COLUMNS[scoring].ppg;
  return SORT_COLUMNS[sort];
}

export function positionMatches(position: string | null, filter: PositionFilter) {
  if (filter === "ALL") return true;
  if (filter === "FLEX") return position !== null && ["RB", "WR", "TE"].includes(position);
  return position === filter;
}

export function normalizeSearch(value: string) { return value.toLowerCase().replace(/[.'’\-]/g, "").replace(/\s+/g, " ").trim(); }

export function searchRank(name: string, query: string, hasSleeperId: boolean, rookieSeason: number | null) {
  const candidate = normalizeSearch(name); const needle = normalizeSearch(query); const words = candidate.split(" ");
  let rank = candidate === needle ? 400 : candidate.startsWith(needle) ? 300 : words.some((word) => word.startsWith(needle)) ? 200 : candidate.includes(needle) ? 100 : 0;
  if (hasSleeperId) rank += 10;
  if ((rookieSeason ?? 0) >= 2020) rank += 5;
  return rank;
}
