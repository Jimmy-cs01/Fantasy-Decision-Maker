import { describe, expect, it } from "vitest";
import {
  isTradePlayerSelectionKey,
  toggleTradePlayerId,
} from "./selection";

describe("manual trade player selection", () => {
  it("selects and deselects a player without disturbing the rest of the package", () => {
    expect(toggleTradePlayerId([], "send-rb")).toEqual(["send-rb"]);
    expect(toggleTradePlayerId(["send-qb", "send-rb"], "send-rb")).toEqual([
      "send-qb",
    ]);
  });

  it("supports multi-player and asymmetric packages on either trade side", () => {
    const send = ["send-qb", "send-rb"];
    const receive = ["receive-wr"];

    expect(toggleTradePlayerId(send, "send-te")).toEqual([
      "send-qb",
      "send-rb",
      "send-te",
    ]);
    expect(toggleTradePlayerId(receive, "receive-rb")).toEqual([
      "receive-wr",
      "receive-rb",
    ]);
  });

  it("recognizes only Enter and Space as row-selection keys", () => {
    expect(isTradePlayerSelectionKey("Enter")).toBe(true);
    expect(isTradePlayerSelectionKey(" ")).toBe(true);
    expect(isTradePlayerSelectionKey("Tab")).toBe(false);
    expect(isTradePlayerSelectionKey("ArrowRight")).toBe(false);
  });
});
