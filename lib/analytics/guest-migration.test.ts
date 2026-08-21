import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../supabase/migrations/20260821171514_guest_analytics.sql", import.meta.url), "utf8");

describe("guest analytics database security", () => {
  it("keeps both analytics tables RLS protected and unavailable to browser roles", () => {
    expect(migration).toContain("alter table public.guest_visitors enable row level security");
    expect(migration).toContain("alter table public.guest_sessions enable row level security");
    expect(migration).toContain("revoke all on table public.guest_visitors from anon, authenticated");
    expect(migration).toContain("revoke all on table public.guest_sessions from anon, authenticated");
  });

  it("limits ingestion RPC execution to service role", () => {
    expect(migration).toContain("revoke all on function public.record_guest_activity(uuid, uuid, text) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.record_guest_activity(uuid, uuid, text) to service_role");
  });
});
