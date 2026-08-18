import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerLink } from "./player-link";

describe("PlayerLink", () => {
  it("routes canonical players to the shared profile", () => {
    const html = renderToStaticMarkup(<PlayerLink playerId="player 1" query="?season=2026">Player One</PlayerLink>);
    expect(html).toContain('href="/players/player%201?season=2026"');
    expect(html).toContain("Player One");
  });

  it("renders safe plain text when no canonical identity exists", () => {
    const html = renderToStaticMarkup(<PlayerLink playerId={null}>Unknown Player</PlayerLink>);
    expect(html).not.toContain("href=");
    expect(html).toContain("Unknown Player");
  });
});
