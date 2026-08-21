import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/migrations/20260821180913_injury_availability.sql", import.meta.url), "utf8");

describe("injury availability schema", () => {
  it("exposes only current read-only football status and keeps history server-only", () => {
    expect(sql).toContain("alter table public.player_injuries enable row level security");
    expect(sql).toContain("alter table public.player_injury_history enable row level security");
    expect(sql).toContain("grant select on table public.player_injuries to anon, authenticated");
    expect(sql).not.toContain("grant select on table public.player_injury_history to anon");
    expect(sql).toContain("grant select, insert, update, delete on table public.player_injury_history to service_role");
  });
});
