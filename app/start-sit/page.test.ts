import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const comparator = readFileSync(new URL("../../components/start-sit/start-sit-comparator.tsx", import.meta.url), "utf8");

describe("Start / Sit page", () => {
  it("uses the reconciled projection pool and synchronized roster IDs in batches", () => {
    expect(page).toContain("getStartSitProjectionPool");
    expect(page).toContain('from("roster_players").select("player_id")');
    expect(page).not.toContain("for (const player");
  });

  it("renders linked player comparisons without a second Vegas adjustment", () => {
    expect(comparator).toContain("<PlayerLink");
    expect(comparator).toContain("Vegas is not counted twice");
    expect(comparator).toContain("recommendStarts");
  });
});
