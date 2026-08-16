import type { LeaderSort, PlayerExplorerFilters, PlayerSeasonRow, PositionFilter, ScoringFormat } from "./types";

export const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export const POSITIONS: PositionFilter[] = ["ALL", "QB", "RB", "WR", "TE", "FLEX"];
export const SCORING_COLUMNS: Record<ScoringFormat, { points: keyof PlayerSeasonRow; ppg: keyof PlayerSeasonRow; label: string }> = {
  standard: { points: "fantasy_points_standard", ppg: "fantasy_points_standard_per_game", label: "Standard" },
  half_ppr: { points: "fantasy_points_half_ppr", ppg: "fantasy_points_half_ppr_per_game", label: "Half PPR" },
  ppr: { points: "fantasy_points_ppr", ppg: "fantasy_points_ppr_per_game", label: "PPR" },
  league: { points: "fantasy_points_league", ppg: "fantasy_points_league_per_game", label: "League scoring" },
};

export const SORT_COLUMNS: Record<Exclude<LeaderSort, "fantasy_points" | "fantasy_ppg">, keyof PlayerSeasonRow> = {
  total_yards: "total_yards", total_touchdowns: "total_touchdowns", snap_share: "snap_share", true_touches: "true_touches",
  pass_attempts: "pass_attempts", completions: "completions", completion_percentage: "completion_percentage", passing_yards: "passing_yards", passing_air_yards: "passing_air_yards", passing_touchdowns: "passing_touchdowns", interceptions_thrown: "interceptions_thrown", yards_per_pass_attempt: "yards_per_pass_attempt", pass_adot: "pass_adot", passer_rating: "passer_rating", passing_td_percentage: "passing_td_percentage", interception_percentage: "interception_percentage", times_sacked: "times_sacked", pressure_percentage: "pressure_percentage", passing_epa: "passing_epa", passing_cpoe: "passing_cpoe", pacr: "pacr",
  rush_attempts: "rush_attempts", rushing_yards: "rushing_yards", rushing_touchdowns: "rushing_touchdowns", yards_per_carry: "yards_per_carry", rushing_td_percentage: "rushing_td_percentage", rush_attempts_red_zone: "rush_attempts_red_zone", rush_attempts_goal_to_go: "rush_attempts_goal_to_go", red_zone_rush_share: "red_zone_rush_share", goal_to_go_rush_share: "goal_to_go_rush_share", rushing_epa: "rushing_epa",
  targets: "targets", receptions: "receptions", receiving_yards: "receiving_yards", receiving_touchdowns: "receiving_touchdowns", receiving_air_yards: "receiving_air_yards", yards_after_catch: "yards_after_catch", yards_per_target: "yards_per_target", yards_per_reception: "yards_per_reception", receiving_adot: "receiving_adot", yards_after_catch_per_reception: "yards_after_catch_per_reception", receiving_td_percentage: "receiving_td_percentage", receiving_epa: "receiving_epa", racr: "racr", average_target_share: "average_target_share", average_air_yards_share: "average_air_yards_share", average_wopr: "average_wopr",
};

export interface StatColumn {
  key: keyof PlayerSeasonRow;
  label: string;
  sort: LeaderSort;
  tooltip: string;
  digits?: number;
  percentage?: boolean;
  width?: number;
  zeroAsDash?: boolean;
}

const column = (key: keyof PlayerSeasonRow, label: string, sort: LeaderSort, tooltip: string, options: Omit<StatColumn, "key" | "label" | "sort" | "tooltip"> = {}): StatColumn => ({ key, label, sort, tooltip, ...options });
const snap = column("snap_share", "SNP %", "snap_share", "Offensive snap share", { digits: 1, percentage: true, width: 76 });
const fantasyColumns = (scoring: ScoringFormat) => {
  const fields = SCORING_COLUMNS[scoring];
  return [
    column(fields.points, "FPTS", "fantasy_points", `${fields.label} fantasy points`, { digits: 1, width: 82 }),
    column(fields.ppg, "PPG", "fantasy_ppg", `${fields.label} fantasy points per game`, { digits: 1, width: 72 }),
  ];
};

const PASS_YARDS = column("passing_yards", "PASS YD", "passing_yards", "Passing yards", { width: 86 });
const RUSH_YARDS = column("rushing_yards", "RUSH YD", "rushing_yards", "Rushing yards", { width: 86 });
const REC_YARDS = column("receiving_yards", "REC YD", "receiving_yards", "Receiving yards", { width: 82 });
const PASS_TD = column("passing_touchdowns", "PASS TD", "passing_touchdowns", "Passing touchdowns", { width: 78 });
const RUSH_TD = column("rushing_touchdowns", "RUSH TD", "rushing_touchdowns", "Rushing touchdowns", { width: 78 });
const REC_TD = column("receiving_touchdowns", "REC TD", "receiving_touchdowns", "Receiving touchdowns", { width: 74 });
const TARGETS = column("targets", "TAR", "targets", "Targets", { width: 64 });
const RECEPTIONS = column("receptions", "REC", "receptions", "Receptions", { width: 64 });
const TOUCHES = column("true_touches", "TOUCH", "true_touches", "Carries plus receptions", { width: 76 });
const TOTAL_YARDS = column("total_yards", "TOTAL YD", "total_yards", "Position-aware total offensive yards", { width: 92 });
const TOTAL_TD = column("total_touchdowns", "TOTAL TD", "total_touchdowns", "Position-aware total touchdowns", { width: 86 });
const YPC = column("yards_per_carry", "Y/C", "yards_per_carry", "Yards per carry", { digits: 1, width: 64 });
const YPT = column("yards_per_target", "Y/TGT", "yards_per_target", "Receiving yards per target", { digits: 1, width: 68 });
const YPR = column("yards_per_reception", "Y/REC", "yards_per_reception", "Yards per reception", { digits: 1, width: 68 });
const TGT_SHARE = column("average_target_share", "TGT %", "average_target_share", "Average weekly target share", { digits: 1, percentage: true, width: 72 });
const AIR_SHARE = column("average_air_yards_share", "AIR %", "average_air_yards_share", "Average weekly air-yards share", { digits: 1, percentage: true, width: 72 });

export function positionColumns(position: PositionFilter, scoring: ScoringFormat): StatColumn[] {
  const fantasy = fantasyColumns(scoring);
  if (position === "QB") return [
    snap, PASS_YARDS, RUSH_YARDS, PASS_TD, RUSH_TD,
    column("pass_attempts", "ATT", "pass_attempts", "Pass attempts", { width: 64 }),
    column("interceptions_thrown", "INT", "interceptions_thrown", "Interceptions thrown", { width: 60 }),
    column("completions", "COMP", "completions", "Pass completions", { width: 68 }),
    column("completion_percentage", "COMP %", "completion_percentage", "Completion percentage", { digits: 1, percentage: true, width: 78 }),
    column("yards_per_pass_attempt", "Y/A", "yards_per_pass_attempt", "Passing yards per attempt", { digits: 1, width: 62 }),
    column("times_sacked", "SACK", "times_sacked", "Times sacked", { width: 66 }),
    column("passing_epa", "PASS EPA", "passing_epa", "Passing expected points added", { digits: 1, width: 88 }),
    column("passing_cpoe", "CPOE", "passing_cpoe", "Completion percentage over expected", { digits: 1, width: 70 }),
    column("pacr", "PACR", "pacr", "Passing air conversion ratio", { digits: 2, width: 68 }),
    ...fantasy,
  ];
  if (position === "RB") return [
    snap,
    column("rush_attempts", "CAR", "rush_attempts", "Carries", { width: 64 }), RUSH_YARDS, RUSH_TD, YPC,
    TARGETS, RECEPTIONS, REC_YARDS, REC_TD, YPT, TOUCHES, TOTAL_YARDS, TOTAL_TD,
    column("rushing_epa", "RUSH EPA", "rushing_epa", "Rushing expected points added", { digits: 1, width: 88 }),
    TGT_SHARE, ...fantasy,
  ];
  if (position === "WR" || position === "TE") return [
    snap, RECEPTIONS, REC_YARDS, REC_TD, TARGETS, YPR, YPT,
    column("receiving_air_yards", "AIR YD", "receiving_air_yards", "Receiving air yards", { width: 80 }),
    column("yards_after_catch", "YAC", "yards_after_catch", "Yards after catch", { width: 66 }),
    TGT_SHARE, AIR_SHARE,
    column("average_wopr", "WOPR", "average_wopr", "Weighted opportunity rating", { digits: 2, width: 70 }),
    column("receiving_epa", "REC EPA", "receiving_epa", "Receiving expected points added", { digits: 1, width: 84 }),
    column("racr", "RACR", "racr", "Receiver air conversion ratio", { digits: 2, width: 68 }),
    ...(position === "WR" ? [RUSH_YARDS, RUSH_TD] : []), ...fantasy,
  ];
  if (position === "FLEX") return [
    snap, TOUCHES, TOTAL_YARDS, TOTAL_TD, RUSH_YARDS, RUSH_TD, RECEPTIONS, REC_YARDS, REC_TD,
    TARGETS, YPC, YPR, YPT, TGT_SHARE, ...fantasy,
  ];
  return [
    snap, TOTAL_YARDS, TOTAL_TD,
    { ...PASS_YARDS, zeroAsDash: true }, { ...RUSH_YARDS, zeroAsDash: true }, { ...REC_YARDS, zeroAsDash: true },
    { ...PASS_TD, zeroAsDash: true }, { ...RUSH_TD, zeroAsDash: true }, { ...REC_TD, zeroAsDash: true },
    TOUCHES, TARGETS, RECEPTIONS, ...fantasy,
  ];
}

export function formatStatValue(input: unknown, columnDefinition: StatColumn): string {
  if (input === null || input === undefined || input === "") return "—";
  const numeric = Number(input);
  if (!Number.isFinite(numeric) || (columnDefinition.zeroAsDash && numeric === 0)) return "—";
  const value = numeric * (columnDefinition.percentage ? 100 : 1);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: columnDefinition.digits ?? 0,
    maximumFractionDigits: columnDefinition.digits ?? 0,
  }) + (columnDefinition.percentage ? "%" : "");
}

export function scoringSortColumn(sort: LeaderSort, scoring: ScoringFormat): keyof PlayerSeasonRow {
  if (sort === "fantasy_points") return SCORING_COLUMNS[scoring].points;
  if (sort === "fantasy_ppg") return SCORING_COLUMNS[scoring].ppg;
  return SORT_COLUMNS[sort];
}

export function positionMatches(position: string | null, filter: PositionFilter) {
  if (filter === "ALL") return position !== null && FANTASY_POSITIONS.includes(position as typeof FANTASY_POSITIONS[number]);
  if (filter === "FLEX") return position !== null && ["RB", "WR", "TE"].includes(position);
  return position === filter;
}

export function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[.'’\-]/g, "").replace(/\s+/g, " ").trim();
}

export function searchRank(name: string, query: string, hasSleeperId: boolean, rookieSeason: number | null) {
  const candidate = normalizeSearch(name); const needle = normalizeSearch(query); const words = candidate.split(" ");
  let rank = candidate === needle ? 400 : candidate.startsWith(needle) ? 300 : words.some((word) => word.startsWith(needle)) ? 200 : candidate.includes(needle) ? 100 : 0;
  if (hasSleeperId) rank += 10;
  if ((rookieSeason ?? 0) >= 2020) rank += 5;
  return rank;
}

const first = (input: string | string[] | undefined) => Array.isArray(input) ? input[0] : input;
export function resolveScoringSelection(requested: string | undefined, hasSelectedLeague: boolean): ScoringFormat {
  if (!requested) return hasSelectedLeague ? "league" : "ppr";
  if (requested === "league") return hasSelectedLeague ? "league" : "ppr";
  return (["standard", "half_ppr", "ppr"].includes(requested) ? requested : "ppr") as ScoringFormat;
}

export function resolveSeason(requested: number, availableSeasons: number[]) {
  return availableSeasons.includes(requested) ? requested : availableSeasons[0];
}

export function parsePlayerFilters(params: Record<string, string | string[] | undefined>): PlayerExplorerFilters {
  const requestedScoring = first(params.scoring); const requestedPosition = first(params.position);
  const scoring = (["standard", "half_ppr", "ppr", "league"].includes(requestedScoring ?? "") ? requestedScoring : "ppr") as ScoringFormat;
  const position = (POSITIONS.includes((requestedPosition ?? "ALL") as PositionFilter) ? (requestedPosition ?? "ALL") : "ALL") as PositionFilter;
  const seasonType = ((first(params.seasonType) ?? first(params.type)) === "POST" ? "POST" : "REG") as "REG" | "POST";
  const visibleSorts = new Set(positionColumns(position, scoring).map((item) => item.sort));
  const requestedSort = first(params.sort) as LeaderSort | undefined;
  const sort = requestedSort && visibleSorts.has(requestedSort) ? requestedSort : "fantasy_points";
  return { scoring, leagueId: first(params.leagueId) ?? null, position, seasonType, sort, page: Math.max(1, Number.parseInt(first(params.page) ?? "1", 10) || 1), view: first(params.view) === "all" ? "all" : "leaders" };
}
