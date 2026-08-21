"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { GUEST_ANALYTICS_SESSION_KEY, GUEST_BROWSER_ID_KEY, getOrCreateAnonymousId } from "@/lib/analytics/guest";

export function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const anonymousId = getOrCreateAnonymousId(window.localStorage, GUEST_BROWSER_ID_KEY);
    const sessionId = getOrCreateAnonymousId(window.sessionStorage, GUEST_ANALYTICS_SESSION_KEY);
    const controller = new AbortController();
    void fetch("/api/analytics/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anonymousId, sessionId, path: pathname }),
      keepalive: true,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [pathname]);
  return null;
}
