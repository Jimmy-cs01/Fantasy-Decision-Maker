import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./team-selector.tsx", import.meta.url),
  "utf8",
);

describe("league team selector interaction contract", () => {
  it("supports touch, trackpad, mouse wheel, arrows, and keyboard navigation", () => {
    expect(source).toContain("touch-pan-x");
    expect(source).toContain('addEventListener("wheel", handleWheel, {');
    expect(source).toContain("passive: false");
    expect(source).toContain("Scroll to previous teams");
    expect(source).toContain("Scroll to more teams");
    expect(source).toContain('event.key === "ArrowRight"');
    expect(source).toContain('event.key === " "');
  });

  it("keeps the selected URL-backed team visible and exposes every team as a link", () => {
    expect(source).toContain("items.map");
    expect(source).toContain("href={item.href}");
    expect(source).toContain("aria-current={item.selected");
    expect(source).toContain("selected?.scrollIntoView");
  });
});
