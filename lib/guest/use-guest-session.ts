"use client";

import { useMemo, useSyncExternalStore } from "react";
import { GUEST_SESSION_KEY, parseGuestSession } from "./session";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("jimmy-gm:guest-session", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("jimmy-gm:guest-session", callback);
  };
};

export function useGuestSession() {
  const serialized = useSyncExternalStore(
    subscribe,
    () => window.sessionStorage.getItem(GUEST_SESSION_KEY),
    () => null,
  );
  return useMemo(() => parseGuestSession(serialized), [serialized]);
}
