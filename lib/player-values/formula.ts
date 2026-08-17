import { CMC_2019_CALIBRATION, VALUE_DISPLAY_CALIBRATION, VALUE_WEIGHTS } from "./config";
import type { ProjectionConfidence } from "../projections/types";
import type { PlayerValueResult, PositionReplacementProfile, ValuePlayerProjection } from "./types";

interface RawValueInput {
  medianPpg: number;
  floorPpg: number;
  ceilingPpg: number;
  expectedGames: number;
  profile: Pick<PositionReplacementProfile, "replacementPpg" | "starterPpg" | "elitePpg" | "scarcityDropoff">;
  confidence: ProjectionConfidence;
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
  const raw = (
    rosVorp
    + VALUE_WEIGHTS.floorVorp * floorVorp
    + VALUE_WEIGHTS.upside * upside
    + VALUE_WEIGHTS.scarcity * scarcityBonus
  ) * VALUE_WEIGHTS.confidence[input.confidence];
  return { rawValue: Math.max(0, raw), vorpPerGame, rosVorp };
}

const CMC_PROFILE = {
  replacementPpg: CMC_2019_CALIBRATION.replacementPpg,
  starterPpg: CMC_2019_CALIBRATION.starterPpg,
  elitePpg: CMC_2019_CALIBRATION.elitePpg,
  scarcityDropoff: CMC_2019_CALIBRATION.elitePpg - CMC_2019_CALIBRATION.replacementPpg,
};

export const CMC_2019_RAW_VALUE = calculateRawPlayerValue({
  medianPpg: CMC_2019_CALIBRATION.medianPpg,
  floorPpg: CMC_2019_CALIBRATION.floorPpg,
  ceilingPpg: CMC_2019_CALIBRATION.ceilingPpg,
  expectedGames: CMC_2019_CALIBRATION.games,
  profile: CMC_PROFILE,
  confidence: CMC_2019_CALIBRATION.confidence,
}).rawValue;

export function historicalCmc2019AnchorValue() {
  return normalizePlayerValue(CMC_2019_RAW_VALUE, true);
}

export function normalizePlayerValue(rawValue: number, historicalCmcAnchor = false) {
  if (historicalCmcAnchor) return 100;
  const ratio = clamp(rawValue / CMC_2019_RAW_VALUE, 0, 1);
  const calibrated = VALUE_DISPLAY_CALIBRATION.method === "power"
    ? 100 * Math.pow(ratio, VALUE_DISPLAY_CALIBRATION.exponent)
    : 100 * ratio;
  return round(clamp(calibrated, 0, 99.9));
}

export function playerValueTier(value: number) {
  if (value >= 95) return "Historic / League-Breaking";
  if (value >= 90) return "Elite Cornerstone";
  if (value >= 80) return "Elite Fantasy Asset";
  if (value >= 70) return "High-End Starter";
  if (value >= 60) return "Strong Starter";
  if (value >= 50) return "Solid Starter";
  if (value >= 40) return "FLEX / Lower Starter";
  if (value >= 30) return "Useful Depth";
  if (value >= 20) return "Bench Value";
  if (value >= 10) return "Fringe Roster";
  return "Replacement / Waiver";
}

export function expectedGamesRemaining(week: number, regularSeasonGames = 17) {
  return clamp(18 - week, 0, regularSeasonGames);
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
  const raw = calculateRawPlayerValue({
    medianPpg: player.projectedPpg,
    floorPpg: player.floorPpg,
    ceilingPpg: player.ceilingPpg,
    expectedGames,
    profile,
    confidence: player.confidence,
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
    overallRank: 0,
    positionRank: 0,
  };
}
