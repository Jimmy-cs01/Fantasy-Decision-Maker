import { calculateProjectedFantasyPoints } from "./scoring";
import type { ProjectedStatLine, ProjectionConfidence } from "./types";

export type ProjectionOutlier = "normal" | "watch" | "large" | "extreme";

export interface ProjectionDepthContext {
  depthRank: number;
  isStarter: boolean;
  depthPosition?: string | null;
}

export interface VegasPropEvidence {
  market: string;
  line: number;
  overOdds?: number | null;
  booksReporting: number;
  lineStddev?: number | null;
  capturedAt: string;
}

export interface VegasGameEvidence {
  teamImpliedTotal?: number | null;
  opponentImpliedTotal?: number | null;
  spread?: number | null;
  gameTotal?: number | null;
  moneyline?: number | null;
  booksReporting?: number;
  capturedAt?: string | null;
  kickoff?: string | null;
  isHome?: boolean | null;
}

export interface ProjectionArbitrationInput {
  position: string;
  rawStats: ProjectedStatLine;
  modelPpr: number;
  currentTeam: string | null;
  depth?: ProjectionDepthContext | null;
  historicalGames?: number;
  recentOpportunityShare?: number | null;
  sleeperPpr?: number | null;
  vegasProps?: VegasPropEvidence[];
  vegasGame?: VegasGameEvidence | null;
  scoringSettings?: Record<string, number>;
  modelConfidence?: ProjectionConfidence;
  now?: Date;
}

export interface ProjectionDiagnostics {
  rawModelPpr: number;
  opportunityAdjustedPpr: number;
  vegasPpr: number | null;
  sleeperPpr: number | null;
  sleeperWeight: number;
  modelWeight: number;
  vegasWeight: number;
  opportunityConfidence: number;
  roleAdjustment: number;
  sanityAdjustment: number;
  finalPpr: number;
  absoluteDisagreement: number | null;
  percentageDisagreement: number | null;
  outlierStatus: ProjectionOutlier;
  vegasConfidence: number;
  vegasFreshness: "current" | "aging" | "stale" | "unavailable";
}

export interface ProjectionArbitrationResult {
  stats: ProjectedStatLine;
  finalPpr: number;
  opportunityAdjustedPpr: number;
  vegasPpr: number | null;
  modelWeight: number;
  vegasConfidence: number;
  opportunityConfidence: number;
  outlierStatus: ProjectionOutlier;
  confidence: ProjectionConfidence;
  residualScale: number;
  drivers: string[];
  diagnostics: ProjectionDiagnostics;
}

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));
const finite = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const VOLUME_STATS = new Set<keyof ProjectedStatLine>([
  "pass_attempts", "completions", "passing_yards", "passing_touchdowns",
  "interceptions_thrown", "passing_first_downs", "rush_attempts",
  "rushing_yards", "rushing_touchdowns", "rushing_first_downs", "targets",
  "receptions", "receiving_yards", "receiving_touchdowns",
  "receiving_first_downs",
]);

const EXPECTED_PROP_MARKETS: Record<string, string[]> = {
  QB: ["player_pass_yds", "player_pass_tds", "player_pass_interceptions", "player_rush_yds"],
  RB: ["player_rush_yds", "player_receptions", "player_reception_yds", "player_anytime_td"],
  WR: ["player_receptions", "player_reception_yds", "player_anytime_td"],
  TE: ["player_receptions", "player_reception_yds", "player_anytime_td"],
};

const POSITION_MARKET_BASELINE: Record<string, number> = { QB: 17, RB: 9, WR: 9, TE: 7 };

function impliedProbability(american: number | null | undefined) {
  if (american == null || !Number.isFinite(american)) return 0.5;
  return american < 0
    ? Math.abs(american) / (Math.abs(american) + 100)
    : 100 / (american + 100);
}

function opportunityConfidence(input: ProjectionArbitrationInput) {
  if (!input.currentTeam) return 0.03;
  if (!input.depth) return input.historicalGames && input.historicalGames >= 8 ? 0.9 : 0.72;
  if (input.depth.isStarter || input.depth.depthRank <= 1) return 1;
  const position = input.position.toUpperCase();
  const curves: Record<string, number[]> = {
    QB: [1, 0.16, 0.07, 0.03, 0.02],
    RB: [1, 0.72, 0.4, 0.16, 0.07],
    WR: [1, 0.82, 0.66, 0.4, 0.2, 0.1],
    TE: [1, 0.68, 0.38, 0.2, 0.1],
  };
  const curve = curves[position] ?? [1, 0.7, 0.4, 0.2, 0.1];
  const role = curve[Math.min(curve.length, Math.max(1, input.depth.depthRank)) - 1]
    ?? curve[curve.length - 1];
  const demonstrated = input.recentOpportunityShare == null
    ? 0
    : clamp(input.recentOpportunityShare);
  const experienceProtection = (input.historicalGames ?? 0) >= 8
    ? demonstrated * 0.85
    : demonstrated * 0.55;
  return clamp(Math.max(role, experienceProtection), 0.02, 1);
}

function opportunityAdjustedStats(stats: ProjectedStatLine, factor: number) {
  const adjusted: ProjectedStatLine = {};
  for (const [key, raw] of Object.entries(stats) as Array<[keyof ProjectedStatLine, number]>) {
    adjusted[key] = VOLUME_STATS.has(key) ? finite(raw) * factor : finite(raw);
  }
  if (adjusted.rushing_touchdowns != null) {
    adjusted.rushing_touchdowns = Math.min(
      adjusted.rushing_touchdowns,
      finite(adjusted.rush_attempts) * 0.07,
    );
  }
  if (adjusted.receiving_touchdowns != null) {
    adjusted.receiving_touchdowns = Math.min(
      adjusted.receiving_touchdowns,
      finite(adjusted.targets) * 0.08,
    );
  }
  if (adjusted.passing_touchdowns != null) {
    adjusted.passing_touchdowns = Math.min(
      adjusted.passing_touchdowns,
      finite(adjusted.pass_attempts) * 0.09,
    );
  }
  return adjusted;
}

function evidenceAge(capturedAt: string | null | undefined, now: Date) {
  if (!capturedAt) return { factor: 0, label: "unavailable" as const };
  const hours = Math.max(0, (now.getTime() - new Date(capturedAt).getTime()) / 3_600_000);
  if (hours <= 24) return { factor: 1, label: "current" as const };
  if (hours <= 72) return { factor: 0.72, label: "aging" as const };
  if (hours <= 168) return { factor: 0.3, label: "stale" as const };
  return { factor: 0, label: "stale" as const };
}

export function calculateVegasProjection(
  input: ProjectionArbitrationInput,
): { ppr: number | null; confidence: number; weight: number; freshness: ProjectionDiagnostics["vegasFreshness"] } {
  const settings = input.scoringSettings ?? { rec: 1 };
  const expected = EXPECTED_PROP_MARKETS[input.position.toUpperCase()] ?? [];
  const props = (input.vegasProps ?? []).filter((prop) => expected.includes(prop.market));
  const now = input.now ?? new Date();
  const newest = props.map((prop) => prop.capturedAt).sort().at(-1) ?? input.vegasGame?.capturedAt;
  const freshness = evidenceAge(newest, now);
  if (!props.length) {
    const implied = input.vegasGame?.teamImpliedTotal;
    if (implied == null || freshness.factor === 0) {
      return { ppr: null, confidence: 0, weight: 0, freshness: freshness.label };
    }
    const baseline = POSITION_MARKET_BASELINE[input.position.toUpperCase()] ?? 7;
    const environment = clamp(implied / 22.5, 0.65, 1.45);
    const confidence = clamp(0.08 * freshness.factor * Math.min(1, (input.vegasGame?.booksReporting ?? 1) / 6));
    return { ppr: baseline * environment, confidence, weight: 0.05 + confidence * 0.15, freshness: freshness.label };
  }

  const lineByMarket = new Map(props.map((prop) => [prop.market, prop]));
  let direct = 0;
  direct += finite(lineByMarket.get("player_pass_yds")?.line) * finite(settings.pass_yd ?? 0.04);
  direct += finite(lineByMarket.get("player_pass_tds")?.line) * finite(settings.pass_td ?? 4);
  direct += finite(lineByMarket.get("player_pass_interceptions")?.line) * finite(settings.pass_int ?? -2);
  direct += finite(lineByMarket.get("player_pass_attempts")?.line) * finite(settings.pass_att);
  direct += finite(lineByMarket.get("player_pass_completions")?.line) * finite(settings.pass_cmp);
  direct += finite(lineByMarket.get("player_rush_yds")?.line) * finite(settings.rush_yd ?? 0.1);
  direct += finite(lineByMarket.get("player_receptions")?.line) * finite(settings.rec ?? 1);
  direct += finite(lineByMarket.get("player_reception_yds")?.line) * finite(settings.rec_yd ?? 0.1);
  const td = lineByMarket.get("player_anytime_td");
  if (td) {
    const position = input.position.toUpperCase();
    const touchdownValue = position === "WR" || position === "TE"
      ? finite(settings.rec_td ?? 6)
      : position === "RB"
        ? Math.max(finite(settings.rush_td ?? 6), finite(settings.rec_td ?? 6))
        : finite(settings.rush_td ?? 6);
    direct += impliedProbability(td.overOdds) * touchdownValue;
  }

  const coverage = props.length / Math.max(1, expected.length);
  const books = props.reduce((total, prop) => total + prop.booksReporting, 0) / props.length;
  const booksFactor = clamp(books / 6);
  const agreement = 1 - clamp(props.reduce((total, prop) => total + finite(prop.lineStddev), 0) / props.length / 5);
  const confidence = clamp((coverage * 0.55 + booksFactor * 0.3 + agreement * 0.15) * freshness.factor);
  const baseline = POSITION_MARKET_BASELINE[input.position.toUpperCase()] ?? 7;
  const missingShare = Math.max(0, 1 - coverage);
  const teamFactor = input.vegasGame?.teamImpliedTotal == null
    ? 1
    : clamp(input.vegasGame.teamImpliedTotal / 22.5, 0.75, 1.35);
  const ppr = direct + baseline * missingShare * teamFactor;
  return {
    ppr,
    confidence,
    weight: clamp(0.25 + confidence * 0.4, 0.25, 0.65),
    freshness: freshness.label,
  };
}

function classifyOutlier(model: number, external: number | null, confidence: number, sleeper: number | null) {
  const comparisons = [external, sleeper].filter((value): value is number => value != null);
  if (!comparisons.length) return "normal" as const;
  const reference = comparisons.reduce((sum, value) => sum + value, 0) / comparisons.length;
  const absolute = Math.abs(model - reference);
  const percentage = absolute / Math.max(3, reference);
  const severity = absolute * (0.6 + confidence * 0.7) + percentage * 2;
  if (severity >= 12) return "extreme" as const;
  if (severity >= 8) return "large" as const;
  if (severity >= 4) return "watch" as const;
  return "normal" as const;
}

const FANTASY_SCORING_COMPONENTS = new Set<keyof ProjectedStatLine>([
  "passing_yards", "passing_touchdowns", "interceptions_thrown",
  "rushing_yards", "rushing_touchdowns", "receptions",
  "receiving_yards", "receiving_touchdowns",
]);

function reconcileScoringComponents(
  stats: ProjectedStatLine,
  targetPpr: number,
  settings: Record<string, number>,
  position: string,
) {
  const current = calculateProjectedFantasyPoints(stats, settings, position);
  const factor = current > 0 ? targetPpr / current : 0;
  const output = Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [
      key,
      FANTASY_SCORING_COMPONENTS.has(key as keyof ProjectedStatLine)
        ? Math.max(0, finite(value) * factor)
        : finite(value),
    ]),
  ) as ProjectedStatLine;
  output.receptions = Math.min(finite(output.receptions), finite(output.targets));
  output.completions = Math.min(finite(output.completions), finite(output.pass_attempts));

  // Resolve any residual caused by reception/completion bounds through yards,
  // never through attempts, targets, carries, or catches. This preserves the
  // opportunity budgets already established by the football model.
  const scored = calculateProjectedFantasyPoints(output, settings, position);
  const residual = targetPpr - scored;
  const isQuarterback = position.toUpperCase() === "QB";
  const sink = isQuarterback ? "passing_yards" : "receiving_yards";
  const rate = isQuarterback
    ? finite(settings.pass_yd ?? 0.04)
    : finite(settings.rec_yd ?? 0.1);
  if (Math.abs(residual) > 0.005 && rate > 0) {
    output[sink] = Math.max(0, finite(output[sink]) + residual / rate);
  }
  return output;
}

export function arbitrateProjection(input: ProjectionArbitrationInput): ProjectionArbitrationResult {
  const settings = input.scoringSettings ?? { rec: 1 };
  const role = opportunityConfidence(input);
  const opportunityStats = opportunityAdjustedStats(input.rawStats, role);
  const opportunityPpr = calculateProjectedFantasyPoints(opportunityStats, settings, input.position);
  const vegas = calculateVegasProjection(input);
  const sleeper = input.sleeperPpr ?? null;
  const severity: Record<ProjectionOutlier, number> = { normal: 0, watch: 1, large: 2, extreme: 3 };
  const rawOutlier = classifyOutlier(input.modelPpr, vegas.ppr, vegas.confidence, sleeper);
  const adjustedOutlier = classifyOutlier(opportunityPpr, vegas.ppr, vegas.confidence, sleeper);
  const roleOutlier = classifyOutlier(input.modelPpr, opportunityPpr, 1 - role, null);
  const outlier = [rawOutlier, adjustedOutlier, roleOutlier].sort((left, right) => severity[right] - severity[left])[0];
  const modelWeight = 1 - vegas.weight;
  let final = opportunityPpr * modelWeight + (vegas.ppr ?? 0) * vegas.weight;
  let sleeperWeight = 0;

  if (sleeper != null) {
    const roleUncertainty = 1 - role;
    sleeperWeight = clamp(0.08 + roleUncertainty * 0.17, 0.08, 0.25);
    final = final * (1 - sleeperWeight) + sleeper * sleeperWeight;
  }
  if (!input.currentTeam) final = Math.min(final, 0.75);
  final = Math.max(0, final);
  const scoringBeforeScale = calculateProjectedFantasyPoints(opportunityStats, settings, input.position);
  const reconciled = reconcileScoringComponents(
    opportunityStats,
    scoringBeforeScale > 0 ? final : 0,
    settings,
    input.position,
  );
  const finalPpr = calculateProjectedFantasyPoints(reconciled, settings, input.position);
  const absolute = vegas.ppr == null ? null : Math.abs(opportunityPpr - vegas.ppr);
  const percentage = absolute == null ? null : absolute / Math.max(3, vegas.ppr ?? 0);
  const confidence: ProjectionConfidence = !input.currentTeam || role < 0.25 || outlier === "extreme"
    ? "low"
    : vegas.confidence >= 0.65 && outlier === "normal" && role >= 0.8
      ? "high"
      : input.modelConfidence ?? "medium";
  const drivers: string[] = [];
  if (!input.currentTeam) drivers.push("No current NFL team substantially reduces expected opportunity");
  else if (input.depth && role < 0.5) drivers.push(`Raw model workload was reduced for a ${input.depth.depthPosition ?? input.position}${input.depth.depthRank} role`);
  if (vegas.ppr != null && vegas.weight >= 0.25) drivers.push(`Player markets moved the projection ${vegas.ppr > opportunityPpr ? "up" : "down"}`);
  else if (input.vegasGame?.teamImpliedTotal != null) drivers.push(`Team implied total provides limited market context`);
  if (vegas.freshness === "stale") drivers.push("Stale market data receives little or no projection weight");
  if (outlier !== "normal") drivers.push(`${outlier[0].toUpperCase()}${outlier.slice(1)} disagreement across independent projection evidence`);
  if (!drivers.length) drivers.push("Model, role, and available external evidence are broadly consistent");
  const diagnostics: ProjectionDiagnostics = {
    rawModelPpr: input.modelPpr,
    opportunityAdjustedPpr: opportunityPpr,
    vegasPpr: vegas.ppr,
    sleeperPpr: sleeper,
    sleeperWeight,
    modelWeight,
    vegasWeight: vegas.weight,
    opportunityConfidence: role,
    roleAdjustment: opportunityPpr - input.modelPpr,
    sanityAdjustment: finalPpr - input.modelPpr,
    finalPpr,
    absoluteDisagreement: absolute,
    percentageDisagreement: percentage,
    outlierStatus: outlier,
    vegasConfidence: vegas.confidence,
    vegasFreshness: vegas.freshness,
  };
  return {
    stats: reconciled,
    finalPpr,
    opportunityAdjustedPpr: opportunityPpr,
    vegasPpr: vegas.ppr,
    modelWeight,
    vegasConfidence: vegas.confidence,
    opportunityConfidence: role,
    outlierStatus: outlier,
    confidence,
    residualScale: clamp(Math.sqrt(role), 0.08, 1),
    drivers: drivers.slice(0, 4),
    diagnostics,
  };
}
