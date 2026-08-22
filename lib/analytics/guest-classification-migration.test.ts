import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/migrations/20260822014228_extend_guest_analytics_and_projection_horizons.sql", import.meta.url), "utf8");

describe("anonymous visitor classification migration", () => {
  it("keeps analytics server-only while adding guest/anonymous classification", () => {
    expect(sql).toContain("visitor_type text not null default 'anonymous'");
    expect(sql).toContain("visitor_type in ('guest', 'anonymous')");
    expect(sql).toContain("revoke all on function public.record_guest_activity(uuid, uuid, text, text)");
    expect(sql).toContain("grant execute on function public.record_guest_activity(uuid, uuid, text, text)");
    expect(sql).not.toContain("drop function if exists public.record_guest_activity(uuid, uuid, text)");
    expect(sql).not.toContain("grant execute on function public.record_guest_activity(uuid, uuid, text, text)\n  to anon");
  });
});
