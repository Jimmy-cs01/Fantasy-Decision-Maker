import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layout = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");

describe("production metadata", () => {
  it("derives canonical, Open Graph, and Twitter metadata from the site URL helper", () => {
    expect(layout).toContain("metadataBase: new URL(getSiteUrl())");
    expect(layout).toContain('alternates: { canonical: "/" }');
    expect(layout).toContain('url: "/"');
    expect(layout).toContain("twitter:");
  });
});
