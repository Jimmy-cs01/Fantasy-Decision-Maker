import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isTrustedHeadshotUrl, PlayerAvatar, playerInitials } from "./player-avatar";

describe("player avatar", () => {
  const headshot = "https://static.www.nfl.com/image/upload/f_auto,q_auto/league/example";

  it("renders a trusted nflverse/NFL headshot", () => {
    expect(isTrustedHeadshotUrl(headshot)).toBe(true);
    expect(renderToStaticMarkup(<PlayerAvatar name="Player One" headshotUrl={headshot} />)).toContain("<img");
  });

  it("renders initials when a headshot is unavailable or untrusted", () => {
    expect(playerInitials("Player One")).toBe("PO");
    expect(renderToStaticMarkup(<PlayerAvatar name="Player One" headshotUrl={null} />)).toContain("PO");
    expect(isTrustedHeadshotUrl("https://example.com/player.png")).toBe(false);
  });
});

