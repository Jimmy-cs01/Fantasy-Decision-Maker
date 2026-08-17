import { VALUE_DISPLAY_CALIBRATION, VALUE_WEIGHTS } from "./config";
import type { ProjectionConfidence } from "../projections/types";
import type { PlayerValueResult, PositionReplacementProfile, ValuePlayerProjection } from "./types";

interface RawValueInput {
  medianPpg: number;
  floorPpg: number;
  ceilingPpg: number;
  expectedGames: number;
  profile: Pick<PositionReplacementProfile, "replacementPpg" | "starterPpg" | "elitePpg" | "scarcityDropoff">;
  confidence: ProjectionConfidence;
  contextualPpg?: number;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const round = (value: number) => Math.round(value * 10) / 10;

export function calculateRawPlayerValue(input: RawValueInput) {
  const { medianPpg, floorPpg, ceilingPpg, expectedGames, profile } = input;
  const vorpPerGame = medianPpg - profile.replacementPpg;
  const rosVorp = vorpPerGame * expectedGames;
  const floorVorp = Math.max(0, floorPpg - profile.replacementPpg) * expectedGames;
  const upside = Math.max(0, ceilingPpg - medianPpg) * expectedGames;
  const eliteDenominator = Math.max(0.01, profile.elitePpg - profile.starterPpg);
  const eliteShare = clamp((medianPpg - profile.starterPpg) / eliteDenominator, 0, 1);
  const scarcityBonus = profile.scarcityDropoff * expectedGames * eliteShare;
  const productionRaw = (
    rosVorp
    + VALUE_WEIGHTS.floorVorp * floorVorp
    + VALUE_WEIGHTS.upside * upside
    + VALUE_WEIGHTS.scarcity * scarcityBonus
  ) * VALUE_WEIGHTS.confidence[input.confidence];
  return {
    rawValue: productionRaw + (input.contextualPpg ?? 0) * expectedGames,
    vorpPerGame,
    rosVorp,
  };
}

function softplus(value: number) {
  if (value > 30) return value;
  if (value < -30) return Math.exp(value);
  return Math.log1p(Math.exp(value));
}

/** Maps signed production onto a near-0-to-50 scale with a rare, soft 50-55 tail. */
export function normalizePlayerValue(rawValue: number) {
  const calibration = VALUE_DISPLAY_CALIBRATION;
  const reference = softplus(calibration.referenceRawValue / calibration.temperature);
  const base = calibration.referenceDisplayValue
    * softplus(rawValue / calibration.temperature)
    / reference;
  if (base <= calibration.softTailStart) return round(Math.max(0, base));
  const tail = calibration.softTailStart
    + (calibration.softTailLimit - calibration.softTailStart)
    * (1 - Math.exp(-(base - calibration.softTailStart) / calibration.softTailRate));
  return round(tail);
}

export function playerValueTier(value: number) {
  if (value >= 50) return "Generational / Historic";
  if (value >= 45) return "Elite Cornerstone";
  if (value >= 38) return "Elite Fantasy Asset";
  if (value >= 30) return "High-End Starter";
  if (value >= 24) return "Strong Starter";
  if (value >= 18) return "Solid Starter";
  if (value >= 12) return "FLEX / Lower Starter";
  if (value >= 7) return "Useful Depth";
  if (value >= 3) return "Bench Value";
  if (value >= 1) return "Fringe Roster";
  return "Replacement / Waiver";
}

export function expectedGamesRemaining(week: number, regularSeasonGames = 17) {
  return clamp(18 - week, 0, regularSeasonGames);
}

export function ageAtSeason(birthDate: string | null | undefined, season: number | undefined) {
  if (!birthDate || !season) return null;
  const born = new Date(birthDate + "T00:00:00Z");
  if (Number.isNaN(born.valueOf())) return null;
  let age = season - born.getUTCFullYear();
  if (born.getUTCMonth() > 8 || (born.getUTCMonth() === 8 && born.getUTCDate() > 1)) age -= 1;
  return age;
}

export function ageUpsidePpg(player: ValuePlayerProjection) {
  const age = ageAtSeason(player.birthDate, player.season);
  if (age === null) return 0;
  if (player.position === "QB") return age <= 25 ? 0.12 : age >= 38 ? -0.18 : 0;
  if (player.position === "RB") return age <= 23 ? 0.35 : age <= 25 ? 0.18 : age >= 30 ? -0.3 : age >= 28 ? -0.12 : 0;
  if (player.position === "WR") return age <= 23 ? 0.28 : age <= 25 ? 0.14 : age >= 33 ? -0.2 : age >= 31 ? -0.08 : 0;
  return age <= 24 ? 0.18 : age >= 34 ? -0.15 : age >= 32 ? -0.06 : 0;
}

export function depthOpportunityPpg(player: ValuePlayerProjection, profile: PositionReplacementProfile) {
  const rank = player.depthRank;
  if (!rank || rank < 1) return 0;
  if (player.position === "QB") {
    if (rank === 1) return 0.18;
    return profile.demandPerTeam >= 1.5 ? Math.max(-0.5, -0.2 * (rank - 1)) : Math.max(-1.25, -0.8 * (rank - 1));
  }
  if (player.position === "RB") {
    if (rank === 1) return 0.22;
    if (rank === 2) return (ageAtSeason(player.birthDate, player.season) ?? 99) <= 25 ? 0.15 : 0;
    return Math.max(-0.55, -0.12 * (rank - 2));
  }
  if (player.position === "WR") return rank <= 3 ? 0.12 : Math.max(-0.4, -0.08 * (rank - 3));
  return rank === 1 ? 0.15 : rank === 2 ? 0 : Math.max(-0.35, -0.1 * (rank - 2));
}

function scenarioValue(ppg: number, expectedGames: number, profile: PositionReplacementProfile, confidence: ProjectionConfidence) {
  return normalizePlayerValue(calculateRawPlayerValue({
    medianPpg: ppg,
    floorPpg: ppg,
    ceilingPpg: ppg,
    expectedGames,
    profile,
    confidence,
  }).rawValue);
}

export function calculatePlayerValue(player: ValuePlayerProjection, profile: PositionReplacementProfile, expectedGames: number): PlayerValueResult {
  const ageAdjustment = ageUpsidePpg(player);
  const depthAdjustment = depthOpportunityPpg(player, profile);
  const raw = calculateRawPlayerValue({
    medianPpg: player.projectedPpg,
    floorPpg: player.floorPpg,
    ceilingPpg: player.ceilingPpg,
    expectedGames,
    profile,
    confidence: player.confidence,
    contextualPpg: ageAdjustment + depthAdjustment,
  });
  const value = normalizePlayerValue(raw.rawValue);
  const floorValue = scenarioValue(player.floorPpg, expectedGames, profile, player.confidence);
  const ceilingValue = scenarioValue(player.ceilingPpg, expectedGames, profile, player.confidence);
  return {
    playerId: player.playerId,
    fullName: player.fullName,
    position: player.position,
    value,
    tier: playerValueTier(value),
    projectedPpg: round(player.projectedPpg),
    replacementPpg: round(profile.replacementPpg),
    vorpPerGame: round(raw.vorpPerGame),
    rosVorp: round(raw.rosVorp),
    rawValue: round(raw.rawValue),
    floorValue: Math.min(value, floorValue),
    medianValue: value,
    ceilingValue: Math.max(value, ceilingValue),
    confidence: player.confidence,
    expectedGamesRemaining: expectedGames,
    priorSeasonPpg: player.priorSeasonPpg ?? null,
    priorWeight: round(player.priorWeight ?? 0),
    ageAdjustment: round(ageAdjustment),
    depthAdjustment: round(depthAdjustment),
    depthRole: player.depthPosition && player.depthRank ? player.depthPosition + player.depthRank : null,
    overallRank: 0,
    positionRank: 0,
  };
}
