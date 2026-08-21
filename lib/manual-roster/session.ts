export const MANUAL_ROSTER_KEY = "jimmy-gm:manual-roster:v1";

export interface ManualRosterState {
  myPlayerIds: string[];
  partnerPlayerIds: string[];
}

export const EMPTY_MANUAL_ROSTER: ManualRosterState = { myPlayerIds: [], partnerPlayerIds: [] };

export function parseManualRoster(value: string | null): ManualRosterState {
  if (!value) return EMPTY_MANUAL_ROSTER;
  try {
    const parsed = JSON.parse(value) as Partial<ManualRosterState>;
    const ids = (candidate: unknown) => Array.isArray(candidate)
      ? [...new Set(candidate.filter((item): item is string => typeof item === "string"))]
      : [];
    return { myPlayerIds: ids(parsed.myPlayerIds), partnerPlayerIds: ids(parsed.partnerPlayerIds) };
  } catch {
    return EMPTY_MANUAL_ROSTER;
  }
}

export function readManualRoster(storage: Pick<Storage, "getItem"> = sessionStorage) {
  return parseManualRoster(storage.getItem(MANUAL_ROSTER_KEY));
}

export function writeManualRoster(state: ManualRosterState, storage: Pick<Storage, "setItem"> = sessionStorage) {
  storage.setItem(MANUAL_ROSTER_KEY, JSON.stringify(state));
  if (typeof window !== "undefined" && storage === window.sessionStorage)
    window.dispatchEvent(new Event("jimmy-gm:manual-roster"));
}
