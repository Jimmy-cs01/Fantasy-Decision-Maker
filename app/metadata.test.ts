import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");
const robots = readFileSync(new URL("./robots.ts", import.meta.url), "utf8");
const sitemap = readFileSync(new URL("./sitemap.ts", import.meta.url), "utf8");
const manifest = readFileSync(new URL("./manifest.ts", import.meta.url), "utf8");

describe("production metadata", () => {
  it("uses the production canonical domain with descriptive Open Graph and Twitter metadata", () => {
    expect(layout).toContain("metadataBase: new URL(CANONICAL_SITE_URL)");
    expect(layout).toContain("Fantasy Football Trade Finder, Projections & Start/Sit Tools");
    expect(layout).toContain('alternates: { canonical: "/" }');
    expect(layout).toContain('url: "/"');
    expect(layout).toContain("twitter:");
  });

  it("publishes discoverable public routes while excluding private application areas", () => {
    expect(robots).toContain('disallow: ["/admin", "/api", "/auth", "/dashboard", "/guest", "/login", "/season", "/signup"]');
    for (const route of ["/players", "/trades", "/start-sit", "/matchups", "/depth-charts"]) expect(sitemap).toContain(`"${route}"`);
    expect(sitemap).not.toContain('"/dashboard"');
  });

  it("declares installable app icons", () => {
    expect(manifest).toContain("/icons/icon-192.png");
    expect(manifest).toContain("/icons/icon-512.png");
    expect(layout).toContain("/apple-icon.png");
  });
});
