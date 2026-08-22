import { describe, expect, it } from "vitest";
import { buildWaiverWire, classifySleeperAvailability, pendingWaiverPlayerIds } from "./availability";

const player = (id: string, position = "RB", value = 10) => ({
  id, sleeper_player_id: id, full_name: `Player ${id}`, position, team: "BUF", headshot_url: null,
  is_starter: false, roster_slot: null, roster_slot_index: null, projected_ppg: value,
  projection_floor: value - 3, projection_ceiling: value + 4, last_season_ppg: null,
  player_value: value, position_rank: 1, overall_rank: 1, value_tier: "Starter",
  confidence: "medium", depth_role: "RB1", opponent: "MIA", is_home: true,
  team_implied_total: null, active_game_ppg: value, healthy_player_value: value,
  availability_adjustment: 0, injury_status: null, injury_status_label: null,
  injury_timeline: null, practice_participation: null, injury_data_stale: false,
  current_week_active_probability: 1,
});

describe("Sleeper waiver availability", () => {
  it("never recommends a player rostered anywhere in the selected league", () => {
    const result = buildWaiverWire({ projectionPool: [player("1"), player("2")], rosteredPlayerIds: ["1"] });
    expect(result.map((entry) => entry.sleeper_player_id)).toEqual(["2"]);
  });

  it("distinguishes pending waivers from free agents", () => {
    const pending = pendingWaiverPlayerIds([{ type: "waiver", status: "pending", adds: { "2": 4 } }]);
    expect(classifySleeperAvailability({ sleeperPlayerId: "2", rosteredPlayerIds: new Set(), pendingWaiverPlayerIds: pending })).toBe("waiver");
    expect(classifySleeperAvailability({ sleeperPlayerId: "3", rosteredPlayerIds: new Set(), pendingWaiverPlayerIds: pending })).toBe("free_agent");
  });

  it("ranks by league Player Value then projected PPG and excludes non-fantasy positions", () => {
    const result = buildWaiverWire({ projectionPool: [player("1", "RB", 8), player("2", "WR", 12), player("3", "K", 30)], rosteredPlayerIds: [] });
    expect(result.map((entry) => entry.sleeper_player_id)).toEqual(["2", "1"]);
  });
});
