import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("unauthenticated route separation", () => {
  it("offers distinct login and account creation actions on the landing page", () => {
    const landing = source("../page.tsx");
    expect(landing).toContain('href="/auth"');
    expect(landing).toContain('href="/signup"');
  });

  it("keeps signup out of the login form and gives signup its own route", () => {
    const login = source("./page.tsx");
    const signup = source("../signup/page.tsx");
    expect(login).toContain("action={signInWithPassword}");
    expect(login).not.toContain("action={signUp}");
    expect(signup).toContain("action={signUp}");
    expect(signup).toContain('name="confirmPassword"');
  });

  it("redirects authenticated visitors away from both auth routes", () => {
    expect(source("./page.tsx")).toContain("if (user) redirect(next)");
    expect(source("../signup/page.tsx")).toContain("if (user) redirect(next)");
  });
});

