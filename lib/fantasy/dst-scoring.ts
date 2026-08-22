export type DstScoringSupport = "supported" | "unsupported";

const DST_KEYS = new Set([
  "sack", "int", "fum_rec", "safe", "blk_kick", "def_td", "def_st_td",
  "st_td", "def_2pt", "def_kr_td", "def_pr_td",
  "pts_allow_0", "pts_allow_1_6", "pts_allow_7_13", "pts_allow_14_20",
  "pts_allow_21_27", "pts_allow_28_34", "pts_allow_35p",
  "yds_allow_0_100", "yds_allow_100_199", "yds_allow_200_299",
  "yds_allow_300_349", "yds_allow_350_399", "yds_allow_400_449",
  "yds_allow_450_499", "yds_allow_500_549", "yds_allow_550p",
]);

const DST_PREFIXES = ["def_", "st_", "pts_allow_", "yds_allow_"];
const OTHER_DST_KEYS = new Set([
  "ff", "qb_hit", "sack_yd", "int_ret_yd", "fum_rec_td", "fum_ret_yd",
  "kr_yd", "pr_yd", "blk_kick_ret_yd",
]);

function isDstSetting(key: string) {
  return DST_KEYS.has(key) || OTHER_DST_KEYS.has(key)
    || DST_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function analyzeDstScoring(settings: Record<string, number>) {
  const configured = Object.entries(settings)
    .filter(([, points]) => Number(points) !== 0)
    .filter(([key]) => isDstSetting(key));
  const unsupported = configured
    .filter(([key]) => !DST_KEYS.has(key))
    .map(([key]) => key)
    .sort();
  const supported = configured
    .filter(([key]) => DST_KEYS.has(key))
    .map(([key]) => key)
    .sort();
  const unsupportedNote = unsupported.length
    ? ` Unsupported DST categories: ${unsupported.join(", ")}.`
    : "";
  return {
    configured: configured.map(([key]) => key).sort(),
    supported,
    unsupported,
    scoringCoverage: configured.length ? supported.length / configured.length : 0,
    projectionEnabled: false,
    reason: configured.length
      ? `League DST scoring is readable, but JimmyGM does not yet have a neutral DST component forecast for sacks, turnovers, touchdowns, points allowed, and yards allowed. DST projections remain disabled rather than guessed.${unsupportedNote}`
      : "This Sleeper league does not expose a non-zero DST scoring configuration.",
  };
}
