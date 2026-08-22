import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("admin user analytics page", () => {
  it("requires explicit admin authorization before loading privileged analytics", () => {
    expect(page).toContain("if (!isAdminIdentity(user)) notFound()");
    expect(page.indexOf("notFound()")).toBeLessThan(page.indexOf("getRegisteredAnalytics(now)"));
  });

  it("distinguishes registered, Guest Mode, and anonymous visitors without exposing raw IDs", () => {
    expect(page).toContain("User analytics");
    expect(page).toContain("Guest Mode Visitors");
    expect(page).toContain("Anonymous Visitors");
    expect(page).toContain("Eastern Time (ET)");
    expect(page).not.toContain("anonymous_id");
  });
});
