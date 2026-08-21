import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../supabase/migrations/20260821203000_authenticated_user_analytics.sql", import.meta.url), "utf8");

describe("authenticated analytics database security", () => {
  it("keeps activity inaccessible to browser roles", () => {
    expect(migration).toContain("alter table public.authenticated_user_activity enable row level security");
    expect(migration).toContain("revoke all on table public.authenticated_user_activity from public, anon, authenticated");
    expect(migration).toContain('create policy "Deny browser access to authenticated analytics"');
    expect(migration).toContain("using (false)");
    expect(migration).toContain("with check (false)");
  });

  it("accepts only non-anonymous Auth identities through a service-only function", () => {
    expect(migration).toContain("references auth.users(id)");
    expect(migration).toContain("coalesce(is_anonymous, false) = false");
    expect(migration).toContain("revoke all on function public.record_authenticated_activity(uuid, uuid, text, text)");
    expect(migration).toContain("to service_role");
  });
});
