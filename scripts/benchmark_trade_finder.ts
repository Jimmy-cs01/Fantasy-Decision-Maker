import { performance } from "node:perf_hooks";
import {
  evaluateTrade,
  findTradeSuggestions,
  tradeTotals,
  type TradePlayer,
} from "../lib/trades/engine";
import { optimizeProjectedLineup } from "../lib/player-values/lineup";

const rosterPositions = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "TE",
  "FLEX",
  "SUPER_FLEX",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
  "BN",
];
const positions = [
  "QB",
  "RB",
  "RB",
  "RB",
  "WR",
  "WR",
  "WR",
  "WR",
  "TE",
  "TE",
  "QB",
  "RB",
];
const roster = (teamId: string, offset: number): TradePlayer[] =>
  positions.map((position, index) => ({
    id: `${teamId}-${index}`,
    teamId,
    name: `${teamId} player ${index}`,
    position,
    nflTeam: null,
    headshotUrl: null,
    value: Math.max(1, 34 - index * 2.35 + offset),
    projectedPpg: Math.max(2, 20 - index * 1.15 + offset / 4),
  }));

function legacySearch(
  myRoster: TradePlayer[],
  otherRosters: TradePlayer[][],
  specificPlayerId?: string,
) {
  const candidates = (players: TradePlayer[]) =>
    players
      .filter((player) => (player.value ?? 0) >= 1)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, 12);
  const packages = (players: TradePlayer[]) => {
    const output: TradePlayer[][] = players.map((player) => [player]);
    for (let left = 0; left < players.length; left += 1)
      for (let right = left + 1; right < players.length; right += 1)
        output.push([players[left], players[right]]);
    return output;
  };
  const outgoing = packages(candidates(myRoster)).filter(
    (items) =>
      !specificPlayerId ||
      items.some((player) => player.id === specificPlayerId),
  );
  const currentLineup = optimizeProjectedLineup(
    myRoster.map((player) => ({
      playerId: player.id,
      position: player.position,
      projectedPpg: player.projectedPpg,
    })),
    rosterPositions,
  ).projectedPpg;
  const output = [];
  for (const other of otherRosters)
    for (const send of outgoing)
      for (const receive of packages(candidates(other))) {
        const totals = tradeTotals(send, receive);
        if (totals.percentageDifference > 0.2) continue;
        const outgoingIds = new Set(send.map((player) => player.id));
        const after = [
          ...myRoster.filter((player) => !outgoingIds.has(player.id)),
          ...receive,
        ];
        const lineup = optimizeProjectedLineup(
          after.map((player) => ({
            playerId: player.id,
            position: player.position,
            projectedPpg: player.projectedPpg,
          })),
          rosterPositions,
        ).projectedPpg;
        output.push(lineup - currentLineup);
      }
  return output;
}

function time(label: string, run: () => unknown) {
  const started = performance.now();
  const result = run();
  return {
    label,
    milliseconds: Math.round((performance.now() - started) * 10) / 10,
    resultCount: Array.isArray(result) ? result.length : 0,
  };
}

const mine = roster("mine", 0);
const others = Array.from({ length: 11 }, (_, index) =>
  roster(`team-${index + 1}`, (index % 3) - 1),
);
const legacySpecific = time("legacy specific · 1 opponent", () =>
  legacySearch(mine, [others[0]], mine[2].id),
);
const legacyWhole = time("legacy whole · 1 opponent", () =>
  legacySearch(mine, [others[0]]),
);
const measurements = [
  legacySpecific,
  time("optimized specific · 11 opponents", () =>
    findTradeSuggestions({
      myRoster: mine,
      otherRosters: others,
      rosterPositions,
      specificPlayerId: mine[2].id,
    }),
  ),
  legacyWhole,
  time("optimized whole · 11 opponents", () =>
    findTradeSuggestions({
      myRoster: mine,
      otherRosters: others,
      rosterPositions,
    }),
  ),
];
console.table(measurements);
const representative = findTradeSuggestions({
  myRoster: mine,
  otherRosters: others,
  rosterPositions,
});
console.log("Selected trade shapes:", representative.reduce<Record<string, number>>((counts, suggestion) => {
  counts[suggestion.tradeShape] = (counts[suggestion.tradeShape] ?? 0) + 1;
  return counts;
}, {}));
const exampleA = [
  { ...roster("example-a", 0)[4], id: "asset-a", value: 36, projectedPpg: 18 },
  { ...roster("example-a", 0)[1], id: "asset-b", value: 26, projectedPpg: 13 },
  ...roster("example-a", 0).slice(0, 4).map((player, index) => ({ ...player, id: `a-roster-${index}` })),
];
const exampleB = [
  { ...roster("example-b", 0)[4], id: "asset-c", value: 28, projectedPpg: 14 },
  { ...roster("example-b", 0)[1], id: "asset-d", value: 20, projectedPpg: 10 },
  { ...roster("example-b", 0)[8], id: "asset-e", value: 16, projectedPpg: 8 },
  ...roster("example-b", 0).slice(0, 4).map((player, index) => ({ ...player, id: `b-roster-${index}` })),
];
const bloatedPackage = evaluateTrade({
  myRoster: exampleA,
  opponentRoster: exampleB,
  send: exampleA.slice(0, 2),
  receive: exampleB.slice(0, 3),
  rosterPositions: ["QB", "RB", "WR", "FLEX", "BN", "BN"],
  leagueTeams: 12,
});
console.log("Representative 2-for-3 diagnostics:", {
  myStarterPpgDelta: bloatedPackage.myImpact.starterPpgDelta,
  myMarginalDepthDelta: bloatedPackage.myImpact.marginalDepthDelta,
  myDroppedPlayers: bloatedPackage.myImpact.droppedPlayerIds,
  myAssetValueDelta: bloatedPackage.myImpact.assetValueDelta,
  packageComplexityAdjustment: bloatedPackage.packageComplexityAdjustment,
  finalTradeFit: bloatedPackage.finalTradeFit,
});
console.log(
  `Estimated legacy 11-opponent search: specific ~${Math.round(legacySpecific.milliseconds * 11)}ms; whole ~${Math.round(legacyWhole.milliseconds * 11)}ms (linear opponent extrapolation).`,
);
