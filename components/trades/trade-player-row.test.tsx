import { readFileSync } from "node:fs";
import { Children, type ReactElement, type ReactNode } from "react";
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

interface RowElementProps {
  children: ReactNode;
}

interface SelectionButtonProps {
  type: string;
  onClick: () => void;
  "aria-pressed": boolean;
  children: ReactNode;
}

interface HeadshotLinkProps {
  href: string;
  onClick: (event: { stopPropagation: () => void }) => void;
  "aria-label": string;
}

function rowElement(onToggle = () => undefined, selected = false) {
  return TradePlayerRow({ player, selected, onToggle }) as ReactElement<RowElementProps>;
}

function rowControls(onToggle = () => undefined, selected = false) {
  const row = rowElement(onToggle, selected);
  const children = Children.toArray(row.props.children);
  return {
    button: children[0] as ReactElement<SelectionButtonProps>,
    headshotLink: children[1] as ReactElement<HeadshotLinkProps>,
  };
}

describe("selectable trade player row", () => {
  it("renders the row as the selection control with an obvious selected state", () => {
    const html = renderToStaticMarkup(
      <TradePlayerRow player={player} selected onToggle={() => undefined} />,
    );

    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("ring-cyan-300");
  });

  it("toggles selection when any non-headshot row area is clicked", () => {
    let toggles = 0;
    const { button } = rowControls(() => {
      toggles += 1;
    });

    button.props.onClick();
    expect(toggles).toBe(1);

    const children = Children.toArray(button.props.children) as ReactElement<{
      onClick?: unknown;
    }>[];
    expect(children.every((child) => child.props.onClick == null)).toBe(
      true,
    );
  });

  it("uses the same row toggle behavior for selected SEND and RECEIVE players", () => {
    let sendToggles = 0;
    let receiveToggles = 0;
    rowControls(() => {
      sendToggles += 1;
    }, true).button.props.onClick();
    rowControls(() => {
      receiveToggles += 1;
    }, true).button.props.onClick();

    expect({ sendToggles, receiveToggles }).toEqual({
      sendToggles: 1,
      receiveToggles: 1,
    });
  });

  it("makes only the headshot the canonical profile link", () => {
    const html = renderToStaticMarkup(
      <TradePlayerRow player={player} selected={false} onToggle={() => undefined} />,
    );

    expect(html).toContain('href="/players/canonical-player"');
    expect(html).toContain('aria-label="View Player Name profile"');
    expect(html).toContain("size-11");
    expect(html.match(/href=/g)).toHaveLength(1);
    expect(html).not.toContain(">Player Name</a>");
    expect(html.indexOf("</button>")).toBeLessThan(html.indexOf("<a"));
  });

  it("keeps name, position, value, PPG, and row background in the selection surface", () => {
    const html = renderToStaticMarkup(
      <TradePlayerRow player={player} selected={false} onToggle={() => undefined} />,
    );

    expect(html).toContain("Player Name");
    expect(html).toContain("RB");
    expect(html).toContain("BAL");
    expect(html).toContain("24.5");
    expect(html).toContain("15.2");
    expect(html).toContain('<button type="button"');
  });

  it("isolates headshot activation from row click and keyboard selection", () => {
    const source = readFileSync(
      new URL("./trade-finder.tsx", import.meta.url),
      "utf8",
    );
    const rowSource = source.slice(
      source.indexOf("export function TradePlayerRow"),
      source.indexOf("function PositionBadge"),
    );

    expect(rowSource).toContain("onClick={onToggle}");
    expect(rowSource).toContain("onClick={(event) => event.stopPropagation()}");
    expect(rowSource).toContain("encodeURIComponent(player.id)");
    expect(rowSource).not.toContain("<PlayerLink");
    expect(rowSource).toContain('<button\n        type="button"');
  });

  it("stops headshot click propagation without toggling the row", () => {
    let toggles = 0;
    let propagationStops = 0;
    const { headshotLink } = rowControls(() => {
      toggles += 1;
    });

    headshotLink.props.onClick({
      stopPropagation: () => {
        propagationStops += 1;
      },
    });

    expect(headshotLink.props.href).toBe("/players/canonical-player");
    expect(headshotLink.props["aria-label"]).toBe("View Player Name profile");
    expect(propagationStops).toBe(1);
    expect(toggles).toBe(0);
  });

  it("uses native button and link semantics for independent keyboard activation", () => {
    const { button, headshotLink } = rowControls();

    expect(button.type).toBe("button");
    expect(button.props.type).toBe("button");
    expect(headshotLink.props.href).toBe("/players/canonical-player");
    expect(headshotLink.type).not.toBe("button");
  });

  it("reserves a non-overlapping mobile-sized grid column for the profile target", () => {
    const html = renderToStaticMarkup(
      <TradePlayerRow player={player} selected={false} onToggle={() => undefined} />,
    );

    expect(html).toContain("grid-cols-[2.75rem_minmax(0,1fr)_auto]");
    expect(html).toContain("size-11");
    expect(html).toContain("gap-2");
  });
});
