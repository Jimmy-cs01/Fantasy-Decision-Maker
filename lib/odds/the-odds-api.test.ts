import { describe, expect, it, vi } from "vitest";
import { normalizeNflTeam } from "../nfl/teams";
import { median } from "./consensus";
import { uniquePlayerNameMatches } from "./player-matching";
import { matchOddsGameToSchedule } from "./game-mapping";
import {
  parseFeaturedOdds,
  parsePlayerProps,
  parseQuotaHeaders,
  TheOddsApiProvider,
} from "./the-odds-api";

const event = {
  id: "event-1",
  commence_time: "2026-09-13T20:25:00Z",
  home_team: "Buffalo Bills",
  away_team: "Kansas City Chiefs",
  bookmakers: [{
    key: "book-a",
    last_update: "2026-09-10T12:00:00Z",
    markets: [
      { key: "spreads", outcomes: [{ name: "Buffalo Bills", point: -6.5, price: -110 }, { name: "Kansas City Chiefs", point: 6.5, price: -110 }] },
      { key: "totals", outcomes: [{ name: "Over", point: 47.5, price: -110 }, { name: "Under", point: 47.5, price: -110 }] },
      { key: "h2h", outcomes: [{ name: "Buffalo Bills", price: -260 }, { name: "Kansas City Chiefs", price: 215 }] },
    ],
  }],
};

describe("The Odds API", () => {
  it("normalizes canonical NFL team names and legacy abbreviations", () => {
    expect(normalizeNflTeam("San Francisco 49ers")).toBe("SF");
    expect(normalizeNflTeam("OAK")).toBe("LV");
    expect(normalizeNflTeam("not a team")).toBeNull();
  });

  it("extracts sportsbook spread, total, moneyline, kickoff, and implied totals", () => {
    expect(parseFeaturedOdds([event], 2026, 1)).toEqual([expect.objectContaining({
      externalGameId: "event-1", homeTeam: "BUF", awayTeam: "KC",
      commenceTime: "2026-09-13T20:25:00Z", sportsbook: "book-a",
      homeSpread: -6.5, gameTotal: 47.5, homeMoneyline: -260,
      awayMoneyline: 215, homeImpliedTotal: 27, awayImpliedTotal: 20.5,
    })]);
  });

  it("preserves missing markets as null instead of inventing lines", () => {
    const missing = structuredClone(event);
    missing.bookmakers[0].markets = [missing.bookmakers[0].markets[2]];
    expect(parseFeaturedOdds([missing], 2026, 1)[0]).toMatchObject({
      homeSpread: null, gameTotal: null, homeImpliedTotal: null, awayImpliedTotal: null,
    });
  });

  it("calculates deterministic median consensus without last-book-wins behavior", () => {
    expect(median([-3, -2.5, -6, -1])).toBe(-2.75);
    expect(median([])).toBeNull();
  });

  it("parses quota response headers", () => {
    const headers = new Headers({ "x-requests-used": "12", "x-requests-remaining": "488", "x-requests-last": "3" });
    expect(parseQuotaHeaders(headers)).toEqual({ requestsUsed: 12, requestsRemaining: 488, requestsLast: 3 });
  });

  it("parses event-level Over/Under player props", () => {
    const payload = { ...event, bookmakers: [{ key: "book-a", last_update: "2026-09-10T12:00:00Z", markets: [{
      key: "player_pass_yds", last_update: "2026-09-10T12:30:00Z", outcomes: [
        { name: "Over", description: "Josh Allen", point: 264.5, price: -115 },
        { name: "Under", description: "Josh Allen", point: 264.5, price: -105 },
      ],
    }] }] };
    expect(parsePlayerProps(payload)).toEqual([expect.objectContaining({
      playerName: "Josh Allen", market: "player_pass_yds", line: 264.5,
      overOdds: -115, underOdds: -105,
    })]);
  });

  it("uses the documented event endpoint for props", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...event, bookmakers: [] }), { status: 200 }));
    const provider = new TheOddsApiProvider("test-key", fetcher);
    await provider.getPlayerPropsForEvent("event-1", ["player_pass_yds"]);
    expect(String(fetcher.mock.calls[0][0])).toContain("/events/event-1/odds");
    expect(String(fetcher.mock.calls[0][0])).toContain("markets=player_pass_yds");
  });

  it("rejects ambiguous normalized player names", () => {
    const matches = uniquePlayerNameMatches([
      { id: "one", name: "Mike Thomas" }, { id: "two", name: "Mike Thomas Jr." },
    ]);
    expect(matches.get("mike thomas")).toBeNull();
  });

  it("maps an odds event to the canonical game by teams and nearby kickoff", () => {
    const line = parseFeaturedOdds([event], 2026, 1)[0];
    expect(matchOddsGameToSchedule(line, [
      { id: "wrong-date", home_team: "BUF", away_team: "KC", kickoff: "2026-10-20T20:25:00Z" },
      { id: "canonical", home_team: "BUF", away_team: "KC", kickoff: "2026-09-13T20:25:00Z" },
    ])?.id).toBe("canonical");
  });
});
