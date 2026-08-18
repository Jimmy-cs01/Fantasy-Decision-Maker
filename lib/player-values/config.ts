import type { ValueLeagueConfig } from "./types";
import calibration from "./calibration.json";

export const DEFAULT_VALUE_LEAGUE: ValueLeagueConfig = calibration.defaultLeague;

export const VALUE_WEIGHTS = calibration.weights;
export const VALUE_DISPLAY_CALIBRATION = calibration.displayCalibration;
export const EARLY_SEASON_PRIOR = calibration.earlySeasonPrior;
export const HISTORICAL_UPSIDE = calibration.historicalUpside;
