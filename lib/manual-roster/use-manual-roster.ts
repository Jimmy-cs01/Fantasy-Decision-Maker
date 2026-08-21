"use client";

import { useCallback, useSyncExternalStore } from "react";
import { EMPTY_MANUAL_ROSTER, MANUAL_ROSTER_KEY, parseManualRoster, writeManualRoster, type ManualRosterState } from "./session";

function subscribe(callback: () => void) {
  window.addEventListener("jimmy-gm:manual-roster", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("jimmy-gm:manual-roster", callback);
    window.removeEventListener("storage", callback);
  };
}

export function useManualRoster() {
  const serialized = useSyncExternalStore(
    subscribe,
    () => window.sessionStorage.getItem(MANUAL_ROSTER_KEY),
    () => null,
  );
  const state = serialized ? parseManualRoster(serialized) : EMPTY_MANUAL_ROSTER;
  const update = useCallback((next: ManualRosterState) => writeManualRoster(next), []);
  return { state, update };
}
