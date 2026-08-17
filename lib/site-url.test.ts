import { describe, expect, it } from "vitest";
import { getAbsoluteSiteUrl, getSiteUrl } from "./site-url";

describe("canonical site URL", () => {
  it("uses jimmygm.com when explicitly configured for production", () => {
    const environment = {
      NEXT_PUBLIC_SITE_URL: "https://jimmygm.com",
      NODE_ENV: "production",
    } as const;
    expect(getSiteUrl(environment)).toBe("https://jimmygm.com");
    expect(getAbsoluteSiteUrl("/auth/callback", environment)).toBe(
      "https://jimmygm.com/auth/callback",
    );
  });

  it("never promotes www to the canonical origin", () => {
    expect(getSiteUrl({ NODE_ENV: "production" })).toBe("https://jimmygm.com");
    expect(
      getSiteUrl({
        NODE_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://www.jimmygm.com",
      }),
    ).toBe("https://jimmygm.com");
  });

  it("supports localhost development and an explicit port 3001 override", () => {
    expect(getSiteUrl({ NODE_ENV: "development" })).toBe(
      "http://localhost:3000",
    );
    expect(
      getSiteUrl({
        NODE_ENV: "development",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3001",
      }),
    ).toBe("http://localhost:3001");
  });
});
