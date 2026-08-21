import { describe, expect, it } from "vitest";
import { matchupContextByTeam, type WeeklyMatchup } from "./schedule-service";

describe("NFL matchup context", () => {
  it("maps home and away teams to the correct opponent, spread, and implied total", () => {
    const game: WeeklyMatchup = {
      id: "game", nflverseGameId: "2026_01_KC_BUF", season: 2026, week: 1,
      kickoff: "2026-09-13T20:25:00Z", homeTeam: "BUF", awayTeam: "KC",
      neutralSite: false, externalGameId: "event", homeSpread: -3,
      gameTotal: 51.5, homeImpliedTotal: 27.25, awayImpliedTotal: 24.25,
      booksReporting: 8, latestUpdate: "2026-09-10T00:00:00Z",
    };
    const contexts = matchupContextByTeam([game]);
    expect(contexts.get("BUF")).toMatchObject({ opponent: "KC", isHome: true, spread: -3, teamImpliedTotal: 27.25 });
    expect(contexts.get("KC")).toMatchObject({ opponent: "BUF", isHome: false, spread: 3, teamImpliedTotal: 24.25 });
  });

  it("normalizes nflverse LA to the canonical LAR team before availability lookup", () => {
    const game: WeeklyMatchup = { id: "la", nflverseGameId: "la", season: 2026, week: 1, kickoff: "2026-09-11T00:35:00Z", homeTeam: "LA", awayTeam: "SF", neutralSite: false, externalGameId: null, homeSpread: null, gameTotal: null, homeImpliedTotal: null, awayImpliedTotal: null, booksReporting: 0, latestUpdate: null };
    expect(matchupContextByTeam([game]).get("LAR")).toMatchObject({ opponent: "SF", kickoff: game.kickoff });
  });
});
