import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const logo = readFileSync(new URL("./brand-logo.tsx", import.meta.url), "utf8");
const mark = readFileSync(new URL("../../public/brand/jimmygm-mark.svg", import.meta.url), "utf8");

describe("JimmyGM branding", () => {
  it("uses the shared production mark with accessible decorative image behavior", () => {
    expect(logo).toContain('src="/brand/jimmygm-mark.svg"');
    expect(logo).toContain('aria-hidden="true"');
    expect(mark).toContain("JimmyGM");
  });
});
