import { afterEach, describe, expect, it } from "vitest";
import { getAuthCallbackUrl, getPasswordRecoveryUrl } from "./urls";

const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl;
});

describe("authentication URLs", () => {
  it("uses the configured production callback and safe internal destination", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://jimmygm.com";
    expect(getAuthCallbackUrl("/players?season=2026")).toBe(
      "https://jimmygm.com/auth/callback?next=%2Fplayers%3Fseason%3D2026",
    );
    expect(getPasswordRecoveryUrl()).toBe(
      "https://jimmygm.com/auth/callback?next=%2Fauth%2Fupdate-password",
    );
  });

  it("rejects external return destinations", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://jimmygm.com";
    expect(getAuthCallbackUrl("https://malicious.example/path")).toBe(
      "https://jimmygm.com/auth/callback?next=%2Fdashboard",
    );
  });
});
