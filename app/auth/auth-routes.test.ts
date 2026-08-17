import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

describe("unauthenticated route separation", () => {
  it("offers distinct login and account creation actions on the landing page", () => {
    const landing = source("../page.tsx");
    expect(landing).toContain('href="/login"');
    expect(landing).toContain('href="/signup"');
  });

  it("keeps signup out of the login form and gives signup its own route", () => {
    const login = source("../login/page.tsx");
    const signup = source("../signup/page.tsx");
    expect(login).toContain("action={signInWithPassword}");
    expect(login).not.toContain("action={signUp}");
    expect(signup).toContain("action={signUp}");
    expect(signup).toContain('name="confirmPassword"');
  });

  it("redirects authenticated visitors away from both auth routes", () => {
    expect(source("../login/page.tsx")).toContain("if (user) redirect(next)");
    expect(source("../signup/page.tsx")).toContain("if (user) redirect(next)");
  });

  it("uses canonical callbacks for signup and password recovery", () => {
    const actions = source("./actions.ts");
    const callback = source("./callback/route.ts");
    expect(actions).toContain("emailRedirectTo: getAuthCallbackUrl(next)");
    expect(actions).toContain("redirectTo: getPasswordRecoveryUrl()");
    expect(callback).toContain("exchangeCodeForSession(code)");
    expect(callback).toContain("safeReturnPath");
    expect(callback).toContain("friendlyAuthError");
  });

  it("keeps /auth as a compatibility redirect to the separate login route", () => {
    expect(source("./page.tsx")).toContain("redirect(`/login");
    expect(source("../login/page.tsx")).toContain("Forgot password?");
  });
});
