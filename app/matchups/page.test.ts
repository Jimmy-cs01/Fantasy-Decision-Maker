import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("../../components/nfl/matchup-card.tsx", import.meta.url), "utf8");

describe("matchup explorer", () => {
  it("renders week navigation, schedule context, consensus lines, and embedded depth charts", () => {
    expect(page).toContain("getWeeklyMatchups");
    expect(page).toContain("NFL week");
    expect(card).toContain("booksReporting");
    expect(card).toContain("Compare fantasy depth charts");
    expect(card).toContain("game.homeImpliedTotal");
  });

  it("renders missing odds as a dash rather than fabricated values", () => {
    expect(card).toContain('value == null ? "—"');
    expect(card).toContain("Odds unavailable");
  });
});
