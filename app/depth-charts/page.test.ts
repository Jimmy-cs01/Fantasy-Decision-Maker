import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const component = readFileSync(new URL("../../components/nfl/depth-chart.tsx", import.meta.url), "utf8");

describe("depth-chart explorer", () => {
  it("provides team selection and links canonical players to existing details", () => {
    expect(page).toContain("CURRENT_NFL_TEAMS");
    expect(component).toContain("/players/${player.id}");
    expect(component).toContain("player.depthRank");
    expect(component).toContain("player.playerValue");
    expect(component).toContain("player.projectedPpg");
  });
});
