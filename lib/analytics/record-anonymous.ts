import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { AnonymousVisitorType } from "./guest";

export async function recordAnonymousActivity(input: {
  anonymousId: string;
  sessionId: string;
  path: string | null;
  visitorType: AnonymousVisitorType;
}) {
  const admin = createAdminClient();
  const current = await admin.rpc("record_guest_activity", {
    browser_id: input.anonymousId,
    browser_session_id: input.sessionId,
    visited_path: input.path,
    visitor_kind: input.visitorType,
  });
  if (!current.error || current.error.code !== "PGRST202") return current.error;

  // Preserve activity during a rolling deployment where application code is
  // live just before the classification migration reaches Supabase.
  const legacy = await admin.rpc("record_guest_activity", {
    browser_id: input.anonymousId,
    browser_session_id: input.sessionId,
    visited_path: input.path,
  });
  return legacy.error;
}
