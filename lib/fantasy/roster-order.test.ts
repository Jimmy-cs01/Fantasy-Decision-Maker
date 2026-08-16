import { describe, expect, it } from "vitest";
import { assignStarterSlots, orderRosterPlayers, selectLeagueTeam, starterSlots } from "./roster-order";

const player = (full_name: string, position: string, is_starter: boolean, roster_slot: string | null, roster_slot_index: number | null) => ({ full_name, position, is_starter, roster_slot, roster_slot_index });

describe("Sleeper roster ordering", () => {
  it("preserves repeated starter slots and maps starters by Sleeper array order", () => {
    const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN"];
    expect(starterSlots(positions)).toEqual(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPERFLEX"]);
    const assignments = assignStarterSlots(["qb", "rb1", "rb2", "wr1", "wr2", "te", "flex", "sf"], positions);
    expect(assignments.get("rb2")).toEqual({ rosterSlot: "RB", rosterSlotIndex: 2 });
    expect(assignments.get("sf")).toEqual({ rosterSlot: "SUPERFLEX", rosterSlotIndex: 7 });
  });

  it("orders starters by occupied slot, not natural position, then bench deterministically", () => {
    const ordered = orderRosterPlayers([
      player("Flex Running Back", "RB", true, "FLEX", 6),
      player("Superflex Quarterback", "QB", true, "SUPERFLEX", 5),
      player("Starting Tight End", "TE", true, "TE", 4),
      player("Starting Quarterback", "QB", true, "QB", 0),
      player("Zed Receiver", "WR", false, "BN", null),
      player("Alpha Receiver", "WR", false, "BN", null),
      player("Bench Quarterback", "QB", false, "BN", null),
    ]);
    expect(ordered.map((item) => item.full_name)).toEqual([
      "Starting Quarterback", "Starting Tight End", "Superflex Quarterback", "Flex Running Back",
      "Bench Quarterback", "Alpha Receiver", "Zed Receiver",
    ]);
  });

  it("groups every repeated starter slot in the shared display priority", () => {
    const ordered = orderRosterPlayers([
      player("Kicker", "K", true, "K", 8),
      player("Flex", "WR", true, "FLEX", 7),
      player("Superflex", "QB", true, "SUPERFLEX", 6),
      player("Tight End", "TE", true, "TE", 5),
      player("Receiver Two", "WR", true, "WR", 4),
      player("Receiver One", "WR", true, "WR", 3),
      player("Runner Two", "RB", true, "RB", 2),
      player("Runner One", "RB", true, "RB", 1),
      player("Quarterback", "QB", true, "QB", 0),
    ]);
    expect(ordered.map((item) => item.roster_slot)).toEqual([
      "QB", "RB", "RB", "WR", "WR", "TE", "SUPERFLEX", "FLEX", "K",
    ]);
  });

  it("selects any requested league team and otherwise defaults to the authenticated member's team", () => {
    const teams = [{ id: "mine", name: "Mine", sleeper_roster_id: 1, league_member_id: "member-1" }, { id: "other", name: "Other", sleeper_roster_id: 2, league_member_id: "member-2" }];
    expect(selectLeagueTeam(teams, "other", "member-1")?.id).toBe("other");
    expect(selectLeagueTeam(teams, null, "member-1")?.id).toBe("mine");
  });

  it("uses the same ordering function after switching to any league team", () => {
    const mine = [player("Mine Bench", "QB", false, "BN", null), player("Mine Starter", "RB", true, "FLEX", 1)];
    const other = [player("Other Bench", "WR", false, "BN", null), player("Other Starter", "QB", true, "SUPERFLEX", 1)];
    expect(orderRosterPlayers(mine).map((item) => item.full_name)).toEqual(["Mine Starter", "Mine Bench"]);
    expect(orderRosterPlayers(other).map((item) => item.full_name)).toEqual(["Other Starter", "Other Bench"]);
  });
});
