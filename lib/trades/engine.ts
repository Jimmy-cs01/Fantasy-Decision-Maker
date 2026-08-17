import { optimizeProjectedLineup } from "../player-values/lineup";

export interface TradePlayer {
  id: string;
  teamId: string;
  name: string;
  position: string | null;
  nflTeam: string | null;
  headshotUrl: string | null;
  value: number | null;
  projectedPpg: number | null;
}

export interface TradeSuggestion {
  send: TradePlayer[];
  receive: TradePlayer[];
  sendValue: number;
  receiveValue: number;
  difference: number;
  percentageDifference: number;
  lineupDelta: number;
  score: number;
}

export const TRADE_SEARCH_LIMITS = { playersPerTeam: 12, maxPackageSize: 2, maxResults: 20, valueWindow: 0.2 } as const;

export function tradeTotals(send: TradePlayer[], receive: TradePlayer[]) {
  const sendValue = send.reduce((sum, player) => sum + (player.value ?? 0), 0);
  const receiveValue = receive.reduce((sum, player) => sum + (player.value ?? 0), 0);
  const difference = receiveValue - sendValue;
  const denominator = Math.max(1, (sendValue + receiveValue) / 2);
  return { sendValue, receiveValue, difference, percentageDifference: Math.abs(difference) / denominator };
}

function combinations(players: TradePlayer[], maxSize = TRADE_SEARCH_LIMITS.maxPackageSize) {
  const results: TradePlayer[][] = players.map((player) => [player]);
  if (maxSize >= 2) {
    for (let left = 0; left < players.length; left += 1) {
      for (let right = left + 1; right < players.length; right += 1) results.push([players[left], players[right]]);
    }
  }
  return results;
}

function projectedLineup(roster: TradePlayer[], rosterPositions: string[]) {
  return optimizeProjectedLineup(roster.map((player) => ({ playerId: player.id, position: player.position, projectedPpg: player.projectedPpg })), rosterPositions).projectedPpg;
}

function afterTrade(roster: TradePlayer[], outgoing: TradePlayer[], incoming: TradePlayer[]) {
  const outgoingIds = new Set(outgoing.map((player) => player.id));
  return [...roster.filter((player) => !outgoingIds.has(player.id)), ...incoming];
}

function needScore(roster: TradePlayer[], incoming: TradePlayer[]) {
  const strength = new Map<string, number>();
  for (const player of roster) strength.set(player.position ?? "OTHER", Math.max(strength.get(player.position ?? "OTHER") ?? 0, player.value ?? 0));
  return incoming.reduce((sum, player) => {
    const current = strength.get(player.position ?? "OTHER") ?? 0;
    return sum + Math.max(0, (player.value ?? 0) - current) * 0.05;
  }, 0);
}

export function findTradeSuggestions(options: {
  myRoster: TradePlayer[];
  otherRosters: TradePlayer[][];
  rosterPositions: string[];
  specificPlayerId?: string | null;
  valueWindow?: number;
}) {
  const myCandidates = options.myRoster.filter((player) => (player.value ?? 0) >= 1)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, TRADE_SEARCH_LIMITS.playersPerTeam);
  const outgoingPackages = combinations(myCandidates).filter((pack) => !options.specificPlayerId || pack.some((player) => player.id === options.specificPlayerId));
  const currentMyLineup = projectedLineup(options.myRoster, options.rosterPositions);
  const seen = new Set<string>();
  const suggestions: TradeSuggestion[] = [];
  for (const otherRoster of options.otherRosters) {
    const incomingCandidates = otherRoster.filter((player) => (player.value ?? 0) >= 1)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, TRADE_SEARCH_LIMITS.playersPerTeam);
    for (const send of outgoingPackages) {
      for (const receive of combinations(incomingCandidates)) {
        const key = send.map((player) => player.id).sort().join("+") + "->" + receive.map((player) => player.id).sort().join("+");
        if (seen.has(key)) continue;
        seen.add(key);
        const totals = tradeTotals(send, receive);
        if (totals.percentageDifference > (options.valueWindow ?? TRADE_SEARCH_LIMITS.valueWindow)) continue;
        const lineupDelta = projectedLineup(afterTrade(options.myRoster, send, receive), options.rosterPositions) - currentMyLineup;
        const score = 100 - totals.percentageDifference * 100 + lineupDelta * 2 + needScore(options.myRoster, receive);
        suggestions.push({ ...totals, send, receive, lineupDelta, score });
      }
    }
  }
  return suggestions.sort((left, right) => right.score - left.score || Math.abs(left.difference) - Math.abs(right.difference))
    .slice(0, TRADE_SEARCH_LIMITS.maxResults);
}
