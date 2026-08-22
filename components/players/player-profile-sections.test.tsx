import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DepthChart } from "../nfl/depth-chart";
import { PlayerWeeklyProjections } from "./player-weekly-projections";
import { PlayerHistory } from "./player-history";
import type { WeeklyProjectionView } from "@/lib/projections/service";
import type { PlayerSeasonRow } from "@/lib/players/types";

const weekly = (week: number, points: number): WeeklyProjectionView => ({
  isHome: week === 1,
  isBye: false,
  isForecast: week > 1,
  isCurrent: week === 2,
  kickoff: `2026-09-${String(week + 1).padStart(2, "0")}T17:00:00Z`,
  projection: {
    playerId: "p1", season: 2026, week, seasonType: "REG", team: "MIN", opponent: week === 1 ? "GB" : "CHI",
    stats: {}, modelProjection: points, vegasProjection: null, opportunityAdjustedProjection: null, sleeperProjection: null,
    modelWeight: null, vegasConfidence: null, opportunityConfidence: null, sanityAdjustment: null, outlierClassification: null,
    diagnostics: null, projectedPoints: points, activeGameProjectedPoints: points, availability: null, floor: points - 5, median: points, ceiling: points + 6,
    confidence: "high", drivers: [], scoringMode: "ppr", modelVersion: "v2",
  },
});

describe("player profile sections", () => {
  it("renders generated weekly projections in order and highlights the current week", () => {
    const html = renderToStaticMarkup(<PlayerWeeklyProjections rows={[weekly(1, 12.4), weekly(2, 15.1)]} currentWeek={2} />);
    expect(html.indexOf(">1<")).toBeLessThan(html.indexOf(">2<"));
    expect(html).toContain("CURRENT");
    expect(html).toContain("12.4");
    expect(html).toContain("ROLE FORECAST");
  });

  it("renders offense teammates as links and highlights the current player", () => {
    const players = [
      { id: "p1", name: "Justin Jefferson", team: "MIN", position: "WR", depthPosition: "WR", depthRank: 1, isStarter: true, headshotUrl: null, projectedPpg: null, playerValue: null },
      { id: "p2", name: "Jordan Addison", team: "MIN", position: "WR", depthPosition: "WR", depthRank: 2, isStarter: false, headshotUrl: null, projectedPpg: null, playerValue: null },
    ];
    const html = renderToStaticMarkup(<DepthChart team="MIN offense" players={players} highlightedPlayerId="p1" />);
    expect(html).toContain('href="/players/p2"');
    expect(html).toContain("ring-cyan-400/30");
  });

  it("renders a compact, linked offensive depth chart without detailed analytics", () => {
    const players = [
      { id: "qb1", name: "Quarterback One", team: "MIN", position: "QB", depthPosition: "QB", depthRank: 1, isStarter: true, headshotUrl: null, projectedPpg: 20, playerValue: 30 },
      { id: "wr1", name: "Receiver One", team: "MIN", position: "WR", depthPosition: "WR", depthRank: 1, isStarter: true, headshotUrl: null, projectedPpg: 18, playerValue: 28 },
      { id: "k1", name: "Kicker One", team: "MIN", position: "K", depthPosition: "K", depthRank: 1, isStarter: true, headshotUrl: null, projectedPpg: 8, playerValue: 3 },
    ];
    const html = renderToStaticMarkup(<DepthChart team="MIN offense" players={players} highlightedPlayerId="wr1" compact />);
    expect(html).toContain('href="/players/qb1"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("WR1 · current role");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).not.toContain("Kicker One");
    expect(html).not.toContain("VALUE");
    expect(html).not.toContain("PPG");
  });

  it("renders historical seasons newest first with position finishes", () => {
    const rows = [2025, 2024].map((season) => ({
      player_id: "p1", season, season_type: "REG", historical_position: "WR", games_played: 17,
      fantasy_points_ppr_per_game: season === 2025 ? 18 : 20, total_yards: 1500, total_touchdowns: 10,
    })) as unknown as PlayerSeasonRow[];
    const html = renderToStaticMarkup(<PlayerHistory rows={rows} ppgKey="fantasy_points_ppr_per_game" positionFinishes={new Map([[2025, 4], [2024, 2]])} />);
    expect(html.indexOf(">2025<")).toBeLessThan(html.indexOf(">2024<"));
    expect(html).toContain("WR4");
    expect(html).toContain("WR2");
    expect(html).toContain("Final position rank");
    expect(html).toContain("final rank uses total fantasy points");
  });

  it("renders a missing historical position finish as an em dash", () => {
    const rows = [{
      player_id: "p1", season: 2025, season_type: "REG", historical_position: "TE", games_played: 2,
      fantasy_points_ppr_per_game: 4, total_yards: 50, total_touchdowns: 0,
    }] as unknown as PlayerSeasonRow[];
    const html = renderToStaticMarkup(<PlayerHistory rows={rows} ppgKey="fantasy_points_ppr_per_game" positionFinishes={new Map()} />);
    expect(html).toContain("Final position rank");
    expect(html).toContain("—");
  });
});
