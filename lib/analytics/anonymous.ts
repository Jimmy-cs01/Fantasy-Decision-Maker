import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { buildAnonymousAnalytics, type AnonymousVisitorRecord } from "./anonymous-metrics";

export type { AnonymousAnalytics, AnonymousVisitorRow } from "./anonymous-metrics";

export async function getAnonymousAnalytics(now = new Date()) {
  const admin = createAdminClient();
  const records: AnonymousVisitorRecord[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from("guest_visitors")
      .select("anonymous_id,visitor_type,first_seen,last_seen,session_count,visit_count,last_path")
      .order("last_seen", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw new Error(`Unable to load guest and anonymous analytics: ${error.message}`);
    records.push(...((data ?? []) as AnonymousVisitorRecord[]));
    if ((data ?? []).length < 1000) break;
  }
  return buildAnonymousAnalytics(records, now);
}
