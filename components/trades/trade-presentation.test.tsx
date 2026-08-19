import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  new URL("./trade-finder.tsx", import.meta.url),
  "utf8",
);

describe("trade result presentation", () => {
  it("shows absolute and percentage standalone-value difference with direction", () => {
    expect(component).toContain("Standalone value difference");
    expect(component).toContain("receive side higher");
    expect(component).toContain("net starting-lineup PPG");
    expect(component).toContain("PROJ PPG");
    expect(component).toContain("<TradePackagePlayer");
    expect(component).toContain("Lineup impact");
    expect(component).toContain("impact.lineupNotes.slice(0, 4)");
    expect(component).toContain('label="You"');
    expect(component).toContain('label="Opponent"');
  });

  it("renders one structured impact summary with expandable supporting reasons", () => {
    const suggestionSource = component.slice(
      component.indexOf("function Suggestion({"),
      component.indexOf("function LineupImpact"),
    );

    expect(suggestionSource.match(/<LineupImpact/g)).toHaveLength(1);
    expect(suggestionSource).toContain("Why this trade?");
    expect(suggestionSource).toContain("suggestion.reasons");
    expect(suggestionSource).toContain("describeTradeImpact");
    expect(suggestionSource).not.toContain("depthDelta.toFixed");
  });

  it("keeps manual selection stable and mobile controls compact", () => {
    expect(component).toContain(
      'selectionSignature={`${sendIds.join("+")}->${receiveIds.join("+")}`}',
    );
    expect(component).not.toContain("<TradeSummary\n             key=");
    expect(component).toContain("selected={mobileSide}");
    expect(component).toContain("fixed inset-x-2 bottom-2");
    expect(component).toContain("max-h-[70vh] overflow-y-auto");
  });
});
