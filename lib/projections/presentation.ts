import { calculateProjectedFantasyPoints, scoringSettingsForMode } from "./scoring";
import type { ProjectedStatLine, ProjectionScoringMode } from "./types";
import { availabilityAdjustedPpg } from "../injuries/availability";
import type { InjuryAvailability } from "../injuries/types";

export const DEFAULT_PROJECTION_SCORING_LABEL = "Jimmy GM default PPR";

export function projectionScoringSettings(
  mode: ProjectionScoringMode,
  leagueSettings?: Record<string, number>,
) {
  return mode === "league" && leagueSettings
    ? leagueSettings
    : scoringSettingsForMode(mode === "league" ? "ppr" : mode);
}

export function displayedProjectionPoints(input: {
  stats: ProjectedStatLine;
  position?: string | null;
  mode: ProjectionScoringMode;
  leagueSettings?: Record<string, number>;
  availability?: InjuryAvailability | null;
}) {
  const activePpg = calculateProjectedFantasyPoints(
    input.stats,
    projectionScoringSettings(input.mode, input.leagueSettings),
    input.position,
  );
  return availabilityAdjustedPpg(activePpg, input.availability);
}

export function activeGameProjectionPoints(input: Omit<Parameters<typeof displayedProjectionPoints>[0], "availability">) {
  return calculateProjectedFantasyPoints(input.stats, projectionScoringSettings(input.mode, input.leagueSettings), input.position);
}

export function projectionScoringLabel(mode: ProjectionScoringMode, leagueName?: string | null) {
  if (mode === "league") return leagueName ? `${leagueName} league scoring` : DEFAULT_PROJECTION_SCORING_LABEL;
  if (mode === "half_ppr") return "Jimmy GM default Half PPR";
  if (mode === "standard") return "Jimmy GM default Standard";
  return DEFAULT_PROJECTION_SCORING_LABEL;
}
