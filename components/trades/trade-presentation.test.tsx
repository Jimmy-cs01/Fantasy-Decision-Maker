import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("./trade-finder.tsx", import.meta.url), "utf8");

describe("trade result presentation", () => {
  it("shows absolute and percentage standalone-value difference with direction", () => {
    expect(component).toContain("Standalone value difference");
    expect(component).toContain("receive side higher");
    expect(component).toContain("starter PPG");
    expect(component).toContain("PROJ PPG");
    expect(component).toContain("<TradePackagePlayer");
  });
});
