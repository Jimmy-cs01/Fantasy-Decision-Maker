import type { ProjectedStatLine } from "./types";

export interface V4ComponentEvidence {
  market: string;
  line: number;
  booksReporting: number;
  lineStddev?: number | null;
  capturedAt: string;
}

export interface V4HistoricalBaseline {
  games: number;
  seasons?: number;
  fantasyPpg?: number | null;
  passAttempts?: number | null;
  rushAttempts?: number | null;
  rushingYards?: number | null;
  rushingTouchdowns?: number | null;
  targets?: number | null;
}

export interface V4SleeperComponents {
  passAttempts?: number | null;
  passingYards?: number | null;
  passingTouchdowns?: number | null;
  rushAttempts?: number | null;
  rushingYards?: number | null;
  rushingTouchdowns?: number | null;
  targets?: number | null;
  receptions?: number | null;
  receivingYards?: number | null;
  receivingTouchdowns?: number | null;
}

export interface V4ConsensusResult {
  stats: ProjectedStatLine;
  reasons: string[];
  componentMarketWeight: number;
  componentSleeperWeight: number;
  sleeperComponentsUsed: number;
  historicalProtectionApplied: boolean;
}

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function evidenceFreshness(capturedAt: string, kickoff: string | null | undefined, now: Date) {
  const captured = new Date(capturedAt).getTime();
  const game = kickoff ? new Date(kickoff).getTime() : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(captured) || captured >= game) return 0;
  const ageHours = Math.max(0, (now.getTime() - captured) / 3_600_000);
  if (ageHours <= 24) return 1;
  if (ageHours <= 72) return 0.7;
  if (ageHours <= 168) return 0.25;
  return 0;
}

function marketWeight(evidence: V4ComponentEvidence, kickoff: string | null | undefined, now: Date) {
  const freshness = evidenceFreshness(evidence.capturedAt, kickoff, now);
  const books = clamp(evidence.booksReporting / 5);
  const dispersion = evidence.lineStddev == null
    ? 0.8
    : 1 / (1 + Math.max(0, evidence.lineStddev) / Math.max(1, Math.abs(evidence.line)));
  return clamp(freshness * (0.12 + 0.43 * books) * dispersion, 0, 0.55);
}

function blend(current: number | undefined, external: number | null | undefined, weight: number) {
  if (external == null || !Number.isFinite(external) || weight <= 0) return finite(current);
  return finite(current) * (1 - weight) + Math.max(0, external) * weight;
}

function historicalComponent(
  history: V4HistoricalBaseline | null | undefined,
  component: keyof ProjectedStatLine,
) {
  if (!history) return null;
  const values: Partial<Record<keyof ProjectedStatLine, number | null | undefined>> = {
    pass_attempts: history.passAttempts,
    rush_attempts: history.rushAttempts,
    rushing_yards: history.rushingYards,
    rushing_touchdowns: history.rushingTouchdowns,
    targets: history.targets,
  };
  const value = values[component];
  return value == null || !Number.isFinite(value) ? null : Number(value);
}

/**
 * v4.1 keeps Jimmy dominant near consensus and increases external influence
 * continuously only as the component becomes a more extreme outlier. A
 * corroborating multi-season prior adds evidence without creating a player-
 * identity exception.
 */
export function v41SleeperComponentWeight(input: {
  current: number;
  sleeper: number;
  historical?: number | null;
  historicalGames?: number;
}) {
  const current = Math.max(0, finite(input.current));
  const sleeper = Math.max(0, finite(input.sleeper));
  const disagreement = Math.abs(current - sleeper);
  const relative = disagreement / Math.max(1, current, sleeper);
  const severity = clamp((relative - 0.06) / 0.5);
  if (severity <= 0) return 0;
  let weight = 0.03 * severity + 0.47 * Math.pow(severity, 1.35);
  const historical = input.historical;
  if (
    historical != null
    && Number.isFinite(historical)
    && (input.historicalGames ?? 0) >= 17
    && Math.sign(sleeper - current) === Math.sign(historical - current)
    && Math.abs(historical - current) > Math.max(0.2, disagreement * 0.2)
  ) {
    weight += 0.06 * severity;
  }
  return clamp(weight, 0, 0.56);
}

const MARKET_COMPONENT: Record<string, keyof ProjectedStatLine> = {
  player_pass_attempts: "pass_attempts",
  player_pass_completions: "completions",
  player_pass_yds: "passing_yards",
  player_pass_tds: "passing_touchdowns",
  player_pass_interceptions: "interceptions_thrown",
  player_rush_attempts: "rush_attempts",
  player_rush_yds: "rushing_yards",
  player_rush_tds: "rushing_touchdowns",
  player_receptions: "receptions",
  player_reception_yds: "receiving_yards",
  player_reception_tds: "receiving_touchdowns",
};

const SLEEPER_COMPONENT: Array<[keyof V4SleeperComponents, keyof ProjectedStatLine]> = [
  ["passAttempts", "pass_attempts"], ["passingYards", "passing_yards"],
  ["passingTouchdowns", "passing_touchdowns"], ["rushAttempts", "rush_attempts"],
  ["rushingYards", "rushing_yards"], ["rushingTouchdowns", "rushing_touchdowns"],
  ["targets", "targets"], ["receptions", "receptions"],
  ["receivingYards", "receiving_yards"], ["receivingTouchdowns", "receiving_touchdowns"],
];

/**
 * v4 changes component expectations before fantasy scoring. Market evidence is
 * not added again as a full PPG bonus, preventing the same information from
 * being counted at both component and final-score stages.
 */
export function applyV4ComponentConsensus(input: {
  stats: ProjectedStatLine;
  position: string;
  modelPpr?: number | null;
  sleeperPpr?: number | null;
  historical?: V4HistoricalBaseline | null;
  sleeper?: V4SleeperComponents | null;
  props?: V4ComponentEvidence[];
  kickoff?: string | null;
  now?: Date;
  release?: "v4" | "v4.1";
}): V4ConsensusResult {
  const stats = { ...input.stats };
  const reasons: string[] = [];
  const now = input.now ?? new Date();
  const v41 = input.release === "v4.1";
  const totalPprDisagreement = input.modelPpr == null || input.sleeperPpr == null
    ? null
    : Math.abs(finite(input.sleeperPpr) - finite(input.modelPpr));
  const totalPprSeverity = totalPprDisagreement == null
    ? 1
    : clamp((totalPprDisagreement - 0.75) / 5.25);
  let historicalProtectionApplied = false;
  let componentSleeperWeight = 0;
  let sleeperComponentsUsed = 0;

  // Established dual-threat QBs retain a bounded rushing prior. This is a
  // collapse guard, not a floor: it activates only when the model falls more
  // than 35% below a large, multi-game rushing sample.
  const history = input.historical;
  if (input.position.toUpperCase() === "QB" && history && history.games >= 17) {
    const priorAttempts = finite(history.rushAttempts);
    const priorYards = finite(history.rushingYards);
    const activationRatio = v41 ? 0.82 : 0.65;
    const volumeWeight = v41 ? 0.62 : 0.45;
    if (priorAttempts >= 5 && finite(stats.rush_attempts) < priorAttempts * activationRatio) {
      stats.rush_attempts = blend(stats.rush_attempts, priorAttempts, volumeWeight);
      historicalProtectionApplied = true;
    }
    if (priorYards >= 30 && finite(stats.rushing_yards) < priorYards * activationRatio) {
      stats.rushing_yards = blend(stats.rushing_yards, priorYards, volumeWeight);
      historicalProtectionApplied = true;
    }
    const priorTouchdowns = finite(history.rushingTouchdowns);
    if (priorTouchdowns >= 0.2 && finite(stats.rushing_touchdowns) < priorTouchdowns * (v41 ? 0.75 : 0.55)) {
      stats.rushing_touchdowns = blend(stats.rushing_touchdowns, priorTouchdowns, v41 ? 0.52 : 0.35);
      historicalProtectionApplied = true;
    }
    if (historicalProtectionApplied) reasons.push("Strong multi-year quarterback rushing role prevented an unsupported component collapse");
  }

  // Sleeper components are a modest independent role/volume signal. They do
  // not replace Jimmy and never bypass team opportunity budgets.
  if (input.sleeper) {
    let changed = false;
    let totalSleeperWeight = 0;
    for (const [source, target] of SLEEPER_COMPONENT) {
      const value = input.sleeper[source];
      if (value == null || !Number.isFinite(value)) continue;
      const componentWeight = v41
        ? v41SleeperComponentWeight({
          current: finite(stats[target]),
          sleeper: value,
          historical: historicalComponent(history, target),
          historicalGames: history?.games,
        })
        : 0.18;
      const weight = v41 ? componentWeight * Math.pow(totalPprSeverity, 0.8) : componentWeight;
      stats[target] = blend(stats[target], value, weight);
      totalSleeperWeight += weight;
      sleeperComponentsUsed += 1;
      changed = true;
    }
    if (changed) reasons.push(v41
      ? "Sleeper component consensus progressively corrected a material model outlier"
      : "Sleeper component consensus provided bounded independent role evidence");
    componentSleeperWeight = sleeperComponentsUsed
      ? totalSleeperWeight / sleeperComponentsUsed
      : 0;
  }

  let totalWeight = 0;
  let marketCount = 0;
  for (const evidence of input.props ?? []) {
    const component = MARKET_COMPONENT[evidence.market];
    if (!component) continue;
    const weight = marketWeight(evidence, input.kickoff, now);
    if (weight <= 0) continue;
    stats[component] = blend(stats[component], evidence.line, weight);
    totalWeight += weight;
    marketCount += 1;
  }
  if (marketCount) reasons.push(`Fresh multi-book player markets informed ${marketCount} statistical component${marketCount === 1 ? "" : "s"}`);

  stats.completions = Math.min(finite(stats.completions), finite(stats.pass_attempts));
  stats.receptions = Math.min(finite(stats.receptions), finite(stats.targets));
  for (const key of Object.keys(stats) as Array<keyof ProjectedStatLine>) stats[key] = Math.max(0, finite(stats[key]));
  return {
    stats,
    reasons,
    componentMarketWeight: marketCount ? totalWeight / marketCount : 0,
    componentSleeperWeight,
    sleeperComponentsUsed,
    historicalProtectionApplied,
  };
}
