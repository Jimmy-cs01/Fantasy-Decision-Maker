import { HISTORICAL_UPSIDE, VALUE_DISPLAY_CALIBRATION, VALUE_WEIGHTS } from "./config";
import type { ProjectionConfidence } from "../projections/types";
import type {
  PlayerValueResult,
  PositionReplacementProfile,
  ValuePlayerProjection,
} from "./types";

interface RawValueInput {
  medianPpg: number;
  floorPpg: number;
  ceilingPpg: number;
  expectedGames: number;
  profile: Pick<
    PositionReplacementProfile,
    "replacementPpg" | "starterPpg" | "elitePpg" | "scarcityDropoff"
  >;
  confidence: ProjectionConfidence;
  contextualPpg?: number;
  productionConfidence?: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const round = (value: number) => Math.round(value * 10) / 10;

export function calculateRawPlayerValue(input: RawValueInput) {
  const { medianPpg, floorPpg, ceilingPpg, expectedGames, profile } = input;
  const vorpPerGame = medianPpg - profile.replacementPpg;
  const rosVorp = vorpPerGame * expectedGames;
  const floorVorp =
    Math.max(0, floorPpg - profile.replacementPpg) * expectedGames;
  const upside = Math.max(0, ceilingPpg - medianPpg) * expectedGames;
  const eliteDenominator = Math.max(
    0.01,
    profile.elitePpg - profile.starterPpg,
  );
  const eliteShare = clamp(
    (medianPpg - profile.starterPpg) / eliteDenominator,
    0,
    1,
  );
  const scarcityBonus = profile.scarcityDropoff * expectedGames * eliteShare;
  const productionRaw =
    (rosVorp +
      VALUE_WEIGHTS.floorVorp * floorVorp +
      VALUE_WEIGHTS.upside * upside +
      VALUE_WEIGHTS.scarcity * scarcityBonus) *
    VALUE_WEIGHTS.confidence[input.confidence];
  const productionConfidence = clamp(input.productionConfidence ?? 1, 0.02, 1);
  const opportunityCost =
    (1 - productionConfidence) *
    profile.replacementPpg *
    expectedGames *
    VALUE_WEIGHTS.opportunityCost;
  const opportunityAdjustedRaw =
    productionRaw > 0
      ? productionRaw * productionConfidence - opportunityCost
      : productionRaw;
  return {
    rawValue:
      opportunityAdjustedRaw + (input.contextualPpg ?? 0) * expectedGames,
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
  const reference = softplus(
    calibration.referenceRawValue / calibration.temperature,
  );
  const base =
    (calibration.referenceDisplayValue *
      softplus(rawValue / calibration.temperature)) /
    reference;
  if (base <= calibration.softTailStart) return round(Math.max(0, base));
  const tail =
    calibration.softTailStart +
    (calibration.softTailLimit - calibration.softTailStart) *
      (1 -
        Math.exp(
          -(base - calibration.softTailStart) / calibration.softTailRate,
        ));
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

export function ageAtSeason(
  birthDate: string | null | undefined,
  season: number | undefined,
) {
  if (!birthDate || !season) return null;
  const born = new Date(birthDate + "T00:00:00Z");
  if (Number.isNaN(born.valueOf())) return null;
  let age = season - born.getUTCFullYear();
  if (
    born.getUTCMonth() > 8 ||
    (born.getUTCMonth() === 8 && born.getUTCDate() > 1)
  )
    age -= 1;
  return age;
}

export function ageUpsidePpg(player: ValuePlayerProjection) {
  const age = ageAtSeason(player.birthDate, player.season);
  if (age === null) return 0;
  if (player.position === "QB") return age <= 25 ? 0.12 : age >= 38 ? -0.18 : 0;
  if (player.position === "RB")
    return age <= 23
      ? 0.35
      : age <= 25
        ? 0.18
        : age >= 30
          ? -0.3
          : age >= 28
            ? -0.12
            : 0;
  if (player.position === "WR")
    return age <= 23
      ? 0.28
      : age <= 25
        ? 0.14
        : age >= 33
          ? -0.2
          : age >= 31
            ? -0.08
            : 0;
  return age <= 24 ? 0.18 : age >= 34 ? -0.15 : age >= 32 ? -0.06 : 0;
}

/** Provider-backed organizational investment prior. Null means enrichment is absent and stays neutral. */
export function draftCapitalConfidence(player: ValuePlayerProjection) {
  if (player.draftStatus === null || player.draftStatus === undefined) return 1;
  if (player.draftStatus === "unknown") return 0.55;
  if (player.draftStatus === "undrafted")
    return player.position === "TE"
      ? 0.1
      : player.position === "QB"
        ? 0.08
        : 0.07;
  const round = player.draftRound;
  if (!round) return 0.7;
  const curves: Record<ValuePlayerProjection["position"], number[]> = {
    QB: [1, 0.72, 0.55, 0.42, 0.32, 0.24, 0.18],
    RB: [1, 0.9, 0.76, 0.55, 0.4, 0.28, 0.18],
    WR: [1, 0.85, 0.7, 0.52, 0.38, 0.25, 0.16],
    TE: [0.95, 0.85, 0.74, 0.6, 0.45, 0.32, 0.22],
  };
  return curves[player.position][Math.min(7, Math.max(1, round)) - 1];
}

export function depthOpportunityFactor(
  player: ValuePlayerProjection,
  profile: PositionReplacementProfile,
) {
  const rank = player.depthRank;
  if (!rank || rank < 1) return 1;
  if (player.position === "QB") {
    if (rank === 1) return 1;
    const superflex = profile.demandPerTeam >= 1.5;
    return superflex
      ? Math.max(0.08, 0.32 / (rank - 1))
      : Math.max(0.02, 0.09 / (rank - 1));
  }
  const curves: Record<"RB" | "WR" | "TE", number[]> = {
    RB: [1, 0.72, 0.32, 0.1, 0.05, 0.03],
    WR: [0.98, 0.9, 0.76, 0.42, 0.2, 0.1],
    TE: [1, 0.65, 0.35, 0.18, 0.1, 0.06],
  };
  return curves[player.position][Math.min(6, rank) - 1];
}

export function establishedProductionShare(player: ValuePlayerProjection) {
  return clamp((player.historicalGames ?? 0) / 24, 0, 1);
}

/**
 * Low-history projections need evidence that their opportunity is real. Proven
 * players retain their production signal; speculative players are gated by both
 * organizational investment and current depth-chart access.
 */
export function opportunityConfidence(
  player: ValuePlayerProjection,
  profile: PositionReplacementProfile,
) {
  const established = establishedProductionShare(player);
  const speculative =
    0.03 +
    0.97 *
      draftCapitalConfidence(player) *
      depthOpportunityFactor(player, profile);
  return clamp(established + (1 - established) * speculative, 0.03, 1);
}

export function draftContextPpg(player: ValuePlayerProjection) {
  if (!player.draftStatus || player.draftStatus === "unknown") return 0;
  const established = establishedProductionShare(player);
  const round = player.draftRound;
  const base =
    player.draftStatus === "undrafted"
      ? -0.22
      : !round
        ? 0
        : round === 1
          ? 0.18
          : round === 2
            ? 0.12
            : round === 3
              ? 0.06
              : round >= 6
                ? -0.1
                : 0;
  return base * (1 - established);
}

export function draftLabel(player: ValuePlayerProjection) {
  if (player.draftStatus === "undrafted") return "UDFA";
  if (player.draftStatus === "drafted" && player.draftRound) {
    return `Round ${player.draftRound}${player.draftPick ? `, Pick ${player.draftPick}` : ""}`;
  }
  return null;
}

export function depthOpportunityPpg(
  player: ValuePlayerProjection,
  profile: PositionReplacementProfile,
) {
  const rank = player.depthRank;
  if (!rank || rank < 1) return 0;
  if (player.position === "QB") {
    if (rank === 1) return 0.18;
    return profile.demandPerTeam >= 1.5
      ? Math.max(-0.5, -0.2 * (rank - 1))
      : Math.max(-1.25, -0.8 * (rank - 1));
  }
  if (player.position === "RB") {
    if (rank === 1) return 0.22;
    if (rank === 2)
      return (ageAtSeason(player.birthDate, player.season) ?? 99) <= 25
        ? 0.15
        : 0;
    return Math.max(-1, -0.35 * (rank - 2));
  }
  if (player.position === "WR")
    return rank <= 3 ? 0.12 : Math.max(-0.4, -0.08 * (rank - 3));
  return rank === 1
    ? 0.15
    : rank === 2
      ? 0
      : Math.max(-0.35, -0.1 * (rank - 2));
}

function historicalAgeGate(player: ValuePlayerProjection) {
  const age = ageAtSeason(player.birthDate, player.season);
  if (age === null) return 0.75;
  if (player.position === "QB") return age <= 36 ? 1 : clamp(1 - (age - 36) * 0.18, 0.25, 1);
  const declineStart = player.position === "RB" ? 27 : player.position === "WR" ? 30 : 31;
  return age <= declineStart ? 1 : clamp(1 - (age - declineStart) * 0.2, 0.2, 1);
}

/** Bounded proof-of-ceiling premium; current projection and current role remain dominant. */
export function historicalUpsidePpg(
  player: ValuePlayerProjection,
  profile: PositionReplacementProfile,
) {
  const history = player.historicalContext;
  if (!history?.seasons.length) return 0;
  const excellence = clamp(
    (history.weightedPositionPercentile - 0.65) / 0.35,
    0,
    1,
  );
  const repeatability = 0.45 + 0.55 * history.highEndSeasonRate;
  const sample = clamp(history.sampleGames / 32, 0.25, 1);
  const role = depthOpportunityFactor(player, profile);
  const starterProjection = clamp(
    (player.projectedPpg - profile.replacementPpg) /
      Math.max(1, profile.starterPpg - profile.replacementPpg),
    0.15,
    1,
  );
  return clamp(
    HISTORICAL_UPSIDE.maximumPpgAdjustment * excellence * repeatability * sample *
      historicalAgeGate(player) * role * starterProjection,
    0,
    HISTORICAL_UPSIDE.maximumPpgAdjustment,
  );
}

function scenarioValue(
  ppg: number,
  expectedGames: number,
  profile: PositionReplacementProfile,
  confidence: ProjectionConfidence,
  productionConfidence: number,
  contextualPpg: number,
) {
  return normalizePlayerValue(
    calculateRawPlayerValue({
      medianPpg: ppg,
      floorPpg: ppg,
      ceilingPpg: ppg,
      expectedGames,
      profile,
      confidence,
      productionConfidence,
      contextualPpg,
    }).rawValue,
  );
}

export function calculatePlayerValue(
  player: ValuePlayerProjection,
  profile: PositionReplacementProfile,
  expectedGames: number,
): PlayerValueResult {
  const availability = player.availability;
  const activeMedianPpg = player.activeGamePpg ?? player.projectedPpg;
  const activeFloorPpg = player.activeFloorPpg ?? player.floorPpg;
  const activeCeilingPpg = player.activeCeilingPpg ?? player.ceilingPpg;
  const activeGames = availability?.expectedActiveGamesRemaining ?? expectedGames;
  const ageAdjustment = ageUpsidePpg(player);
  const depthAdjustment = depthOpportunityPpg(player, profile);
  const draftAdjustment = draftContextPpg(player);
  const opportunity = opportunityConfidence(player, profile);
  const historicalUpsideAdjustment = historicalUpsidePpg(player, profile);
  const positiveAgeAdjustment =
    Math.max(0, ageAdjustment) *
    draftCapitalConfidence(player) *
    depthOpportunityFactor(player, profile);
  const gatedAgeAdjustment =
    ageAdjustment < 0 ? ageAdjustment : positiveAgeAdjustment;
  const contextualPpg = gatedAgeAdjustment + depthAdjustment + draftAdjustment + historicalUpsideAdjustment;
  const raw = calculateRawPlayerValue({
    medianPpg: activeMedianPpg,
    floorPpg: activeFloorPpg,
    ceilingPpg: activeCeilingPpg,
    expectedGames: activeGames,
    profile,
    confidence: player.confidence,
    contextualPpg,
    productionConfidence: opportunity,
  });
  const productionRaw = calculateRawPlayerValue({
    medianPpg: activeMedianPpg,
    floorPpg: activeFloorPpg,
    ceilingPpg: activeCeilingPpg,
    expectedGames: activeGames,
    profile,
    confidence: player.confidence,
    productionConfidence: opportunity,
  });
  const productionValue = normalizePlayerValue(productionRaw.rawValue);
  const value = normalizePlayerValue(raw.rawValue);
  const healthyValue = normalizePlayerValue(calculateRawPlayerValue({
    medianPpg: activeMedianPpg,
    floorPpg: activeFloorPpg,
    ceilingPpg: activeCeilingPpg,
    expectedGames,
    profile,
    confidence: player.confidence,
    contextualPpg,
    productionConfidence: opportunity,
  }).rawValue);
  const floorValue = scenarioValue(
    player.floorPpg,
    activeGames,
    profile,
    player.confidence,
    opportunity,
    contextualPpg,
  );
  const ceilingValue = scenarioValue(
    player.ceilingPpg,
    activeGames,
    profile,
    player.confidence,
    opportunity,
    contextualPpg,
  );
  return {
    playerId: player.playerId,
    fullName: player.fullName,
    position: player.position,
    value,
    productionValue,
    fundamentalValue: value,
    futureAssetAdjustment: round(value - productionValue),
    marketValue: null,
    jimmyEdge: null,
    tier: playerValueTier(value),
    projectedPpg: round(player.projectedPpg),
    activeGamePpg: round(activeMedianPpg),
    healthyValue,
    availabilityAdjustment: round(value - healthyValue),
    healthyExpectedGamesRemaining: expectedGames,
    injuryStatus: availability?.status ?? "healthy",
    injuryStatusLabel: availability?.statusLabel ?? "Healthy",
    injuryTimeline: availability?.timelineLabel ?? "No injury designation",
    practiceParticipation: availability?.practiceParticipation ?? null,
    currentWeekActiveProbability: availability?.currentWeekActiveProbability ?? 1,
    injuryDataStale: availability?.isStale ?? false,
    replacementPpg: round(profile.replacementPpg),
    vorpPerGame: round(raw.vorpPerGame),
    rosVorp: round(raw.rosVorp),
    rawValue: round(raw.rawValue),
    floorValue: Math.min(value, floorValue),
    medianValue: value,
    ceilingValue: Math.max(value, ceilingValue),
    confidence: player.confidence,
    expectedGamesRemaining: activeGames,
    priorSeasonPpg: player.priorSeasonPpg ?? null,
    priorWeight: round(player.priorWeight ?? 0),
    ageAdjustment: round(gatedAgeAdjustment),
    depthAdjustment: round(depthAdjustment),
    draftAdjustment: round(draftAdjustment),
    historicalUpsideAdjustment: round(historicalUpsideAdjustment),
    historicalWeightedPpg: player.historicalContext ? round(player.historicalContext.weightedPpg) : null,
    historicalBestPositionRank: player.historicalContext?.bestPositionRank ?? null,
    historicalSeasons: player.historicalContext?.seasons.length ?? 0,
    opportunityConfidence: Math.round(opportunity * 100) / 100,
    draftLabel: draftLabel(player),
    depthRole:
      player.depthPosition && player.depthRank
        ? player.depthPosition + player.depthRank
        : null,
    overallRank: 0,
    positionRank: 0,
  };
}
