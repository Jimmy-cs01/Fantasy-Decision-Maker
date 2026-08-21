import type { ProjectionConfidence } from "../projections/types";
import { slotEligibility } from "../player-values/replacement";
import type { FantasyPosition } from "../player-values/types";

export interface StartSitCandidate {
  id: string;
  name: string;
  position: string | null;
  projectedPpg: number | null;
  floor: number | null;
  ceiling: number | null;
  confidence: ProjectionConfidence | null;
  depthRole?: string | null;
  opponent?: string | null;
  isHome?: boolean | null;
  teamImpliedTotal?: number | null;
  activeGamePpg?: number | null;
  injuryStatus?: string | null;
  injuryTimeline?: string | null;
  practiceParticipation?: string | null;
  activeProbability?: number | null;
}

export interface StartSitRecommendation extends StartSitCandidate {
  rank: number;
  startScore: number;
  recommended: boolean;
  reasons: string[];
  warnings: string[];
}

export function resolveStartSitScoringSettings(
  leagueSettings: Record<string, number> | null | undefined,
  manual: "standard" | "half_ppr" | "ppr",
) {
  return leagueSettings && Object.keys(leagueSettings).length
    ? leagueSettings
    : { rec: manual === "standard" ? 0 : manual === "half_ppr" ? 0.5 : 1 };
}

const CONFIDENCE_ADJUSTMENT: Record<ProjectionConfidence, number> = {
  high: 0.15,
  medium: 0,
  low: -0.15,
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Final reconciled projection remains dominant. The only score adjustments are
 * a bounded downside term and at most 0.15 points for confidence. Vegas is not
 * scored again because it is already represented by the final projection.
 */
export function startDecisionScore(candidate: StartSitCandidate) {
  if (candidate.projectedPpg == null) return Number.NEGATIVE_INFINITY;
  if (["out", "ir", "pup", "suspended", "inactive", "nfi"].includes(candidate.injuryStatus ?? "")) return Number.NEGATIVE_INFINITY;
  const downside = candidate.floor == null
    ? 0
    : clamp((candidate.floor - candidate.projectedPpg) * 0.05, -0.5, 0);
  return candidate.projectedPpg + downside + (candidate.confidence ? CONFIDENCE_ADJUSTMENT[candidate.confidence] : 0);
}

export function isEligibleForLineupSlot(position: string | null, slot: string) {
  if (!position) return false;
  const normalized = slot.trim().toUpperCase();
  if (normalized === "ALL") return ["QB", "RB", "WR", "TE", "K"].includes(position.toUpperCase());
  if (normalized === "K") return position.toUpperCase() === "K";
  return slotEligibility(normalized).includes(position.toUpperCase() as FantasyPosition);
}

export function recommendStarts(
  candidates: StartSitCandidate[],
  options: { slot?: string; starters?: number } = {},
): StartSitRecommendation[] {
  const eligible = candidates.filter((candidate) => !options.slot || isEligibleForLineupSlot(candidate.position, options.slot));
  const ordered = eligible
    .map((candidate) => ({ candidate, score: startDecisionScore(candidate) }))
    .sort((left, right) => right.score - left.score || Number(right.candidate.projectedPpg ?? -1) - Number(left.candidate.projectedPpg ?? -1) || left.candidate.name.localeCompare(right.candidate.name));
  const best = ordered[0]?.candidate;
  const starters = Math.max(1, Math.min(options.starters ?? 1, ordered.length));
  return ordered.map(({ candidate, score }, index) => {
    const reasons: string[] = [];
    const warnings: string[] = [];
    if (best && candidate.id !== best.id && best.projectedPpg != null && candidate.projectedPpg != null) {
      const edge = best.projectedPpg - candidate.projectedPpg;
      if (edge > 0) reasons.push(`${edge.toFixed(1)} projected-point gap to ${best.name}`);
    }
    if (index === 0 && ordered[1]?.candidate.projectedPpg != null && candidate.projectedPpg != null) {
      reasons.push(`+${(candidate.projectedPpg - ordered[1].candidate.projectedPpg!).toFixed(1)} projected PPG edge`);
    }
    if (candidate.floor != null && index === 0) reasons.push(`Higher decision score with a ${candidate.floor.toFixed(1)} floor`);
    if (candidate.confidence === "high") reasons.push("Strong projection confidence");
    if (candidate.depthRole?.endsWith("1")) reasons.push("Established starting role");
    if (candidate.confidence === "low") warnings.push("Limited projection confidence");
    if (candidate.floor != null && candidate.ceiling != null && candidate.ceiling - candidate.floor >= 14) warnings.push("Large projection range");
    if (!candidate.depthRole) warnings.push("Depth-chart role unavailable");
    if (candidate.injuryStatus === "doubtful") warnings.push("Doubtful to play");
    else if (candidate.injuryStatus === "questionable") warnings.push(`Questionable${candidate.practiceParticipation ? ` · ${candidate.practiceParticipation}` : ""}`);
    if (["out", "ir", "pup", "suspended", "inactive", "nfi"].includes(candidate.injuryStatus ?? "")) warnings.push("Unavailable for this game");
    return {
      ...candidate,
      rank: index + 1,
      startScore: Number.isFinite(score) ? Math.round(score * 100) / 100 : score,
      recommended: index < starters,
      reasons: reasons.slice(0, 3),
      warnings: warnings.slice(0, 2),
    };
  });
}
