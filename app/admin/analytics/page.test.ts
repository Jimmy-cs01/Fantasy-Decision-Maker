import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("admin registered-user analytics page", () => {
  it("requires explicit admin authorization before loading privileged analytics", () => {
    expect(page).toContain("if (!isAdminIdentity(user)) notFound()");
    expect(page.indexOf("notFound()")).toBeLessThan(page.indexOf("getRegisteredAnalytics()"));
  });

  it("labels the main dashboard as registered-only and does not render guest identifiers", () => {
    expect(page).toContain("Registered user analytics");
    expect(page).toContain("Guest analytics remain stored separately");
    expect(page).not.toContain("anonymous_id");
    expect(page).not.toContain("Recent guest activity");
  });
});
