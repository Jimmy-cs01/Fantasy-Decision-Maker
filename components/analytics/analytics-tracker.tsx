"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { anonymousVisitorType, GUEST_ANALYTICS_SESSION_KEY, GUEST_BROWSER_ID_KEY, getOrCreateAnonymousId, normalizedAnonymousPath, shouldRecordAnalyticsEvent } from "@/lib/analytics/guest";

export function AnalyticsTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!shouldRecordAnalyticsEvent(window.sessionStorage, pathname)) return;
    const anonymousId = getOrCreateAnonymousId(window.localStorage, GUEST_BROWSER_ID_KEY);
    const sessionId = getOrCreateAnonymousId(window.sessionStorage, GUEST_ANALYTICS_SESSION_KEY);
    void fetch("/api/analytics/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anonymousId, sessionId, path: normalizedAnonymousPath(pathname), visitorType: anonymousVisitorType(pathname) }),
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);
  return null;
}
