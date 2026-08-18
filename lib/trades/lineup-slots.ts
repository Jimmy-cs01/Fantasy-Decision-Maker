const IGNORED_TRADE_EVALUATION_SLOTS = new Set(["K", "DEF"]);
const KICKER_ALIASES = new Set(["K", "PK", "KICKER"]);
const DEFENSE_ALIASES = new Set([
  "DEF",
  "DST",
  "DEFST",
  "DTEAM",
  "TEAMDEF",
  "TEAMDEFENSE",
  "DEFENSE",
]);
const normalizedSlotCache = new Map<string, string>();

export function normalizeTradeEvaluationSlot(slot: string) {
  const cached = normalizedSlotCache.get(slot);
  if (cached) return cached;
  const normalized = slot.trim().toUpperCase();
  const compact = normalized.replace(/[^A-Z]/g, "");
  const result = KICKER_ALIASES.has(compact)
    ? "K"
    : DEFENSE_ALIASES.has(compact)
      ? "DEF"
      : normalized;
  normalizedSlotCache.set(slot, result);
  return result;
}

export function isTradeEvaluationSupportedSlot(slot: string | null | undefined) {
  if (!slot) return true;
  return !IGNORED_TRADE_EVALUATION_SLOTS.has(
    normalizeTradeEvaluationSlot(slot),
  );
}

export function tradeEvaluationRosterPositions(rosterPositions: string[]) {
  return rosterPositions.filter(isTradeEvaluationSupportedSlot);
}
