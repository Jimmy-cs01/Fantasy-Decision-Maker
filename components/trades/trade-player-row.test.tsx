import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TradePlayer } from "@/lib/trades/engine";
import { TradePlayerRow } from "./trade-finder";

const player: TradePlayer = {
  id: "canonical-player",
  teamId: "team-a",
  name: "Player Name",
  position: "RB",
  nflTeam: "BAL",
  headshotUrl: null,
  value: 24.5,
  projectedPpg: 15.2,
};

describe("selectable trade player row", () => {
  it("renders the row as the selection control with an obvious selected state", () => {
    const html = renderToStaticMarkup(
      <TradePlayerRow player={player} selected onToggle={() => undefined} />,
    );

    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("ring-cyan-300");
  });

  it("keeps the canonical profile link without nesting it in a button", () => {
    const html = renderToStaticMarkup(
      <TradePlayerRow player={player} selected={false} onToggle={() => undefined} />,
    );

    expect(html).toContain('href="/players/canonical-player"');
    expect(html).not.toContain("<button");
  });

  it("isolates link activation from row click and keyboard selection", () => {
    const source = readFileSync(
      new URL("./trade-finder.tsx", import.meta.url),
      "utf8",
    );
    const rowSource = source.slice(
      source.indexOf("export function TradePlayerRow"),
      source.indexOf("function PositionBadge"),
    );

    expect(rowSource).toContain("onClick={onToggle}");
    expect(rowSource).toContain("stopPropagation");
    expect(rowSource).toContain("event.target !== event.currentTarget");
    expect(rowSource).toContain("isTradePlayerSelectionKey(event.key)");
    expect(rowSource).not.toContain("<button");
  });
});
