import { describe, expect, it } from "vitest";
import {
  buildProjectionApplyRow,
  validateProjectionApplyRows,
  type ProjectionApplyRow,
} from "./apply-payload";

const target = { modelVersionId: "version-v2", season: 2026, week: 1, seasonType: "REG" };
const source = (index: number, overrides: Partial<ProjectionApplyRow> = {}) => ({
  id: `projection-${index}`,
  player_id: `player-${index}`,
  model_version_id: target.modelVersionId,
  season: target.season,
  week: target.week,
  season_type: target.seasonType,
  team: "BUF",
  opponent_team: "MIA",
  ...overrides,
});

describe("projection reconciliation apply payload", () => {
  it("retains projection, player, model, and week identity", () => {
    const row = buildProjectionApplyRow(source(1), { final_projection_ppr: 12.5 });
    expect(row).toMatchObject({
      id: "projection-1",
      player_id: "player-1",
      model_version_id: "version-v2",
      season: 2026,
      week: 1,
      season_type: "REG",
      team: "BUF",
      opponent_team: "MIA",
      final_projection_ppr: 12.5,
    });
  });

  it("accepts exactly 613 complete v2 rows", () => {
    const rows = Array.from({ length: 613 }, (_, index) => source(index));
    const result = validateProjectionApplyRows(rows, 613, target);
    expect(result.safe).toBe(true);
    expect(result.validRows).toBe(613);
    expect(result.invalidRows).toHaveLength(0);
  });

  it("blocks a row missing player_id before any write", () => {
    const rows = [source(1, { player_id: null })];
    const result = validateProjectionApplyRows(rows, 1, target);
    expect(result.safe).toBe(false);
    expect(result.invalidRows[0].missingFields).toContain("player_id");
  });

  it("does not permit another model version or week in the payload", () => {
    const rows = [source(1, { model_version_id: "version-v1" }), source(2, { week: 2 })];
    const result = validateProjectionApplyRows(rows, 2, target);
    expect(result.safe).toBe(false);
    expect(result.invalidRows[0].contextMismatches).toContain("model_version_id");
    expect(result.invalidRows[1].contextMismatches).toContain("week");
  });

  it("blocks duplicate projection primary keys and row-count mismatches", () => {
    const rows = [source(1), source(1)];
    const result = validateProjectionApplyRows(rows, 613, target);
    expect(result.safe).toBe(false);
    expect(result.countMatches).toBe(false);
    expect(result.duplicateIds).toEqual(["projection-1"]);
  });
});
