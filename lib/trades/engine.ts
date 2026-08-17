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
  lastSeasonPpg?: number | null;
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

export const TRADE_SEARCH_LIMITS = {
  playersPerTeam: 12,
  maxPackageSize: 2,
  maxResults: 20,
  valueWindow: 0.2,
} as const;

export function tradeTotals(send: TradePlayer[], receive: TradePlayer[]) {
  const sendValue = send.reduce((sum, player) => sum + (player.value ?? 0), 0);
  const receiveValue = receive.reduce(
    (sum, player) => sum + (player.value ?? 0),
    0,
  );
  const difference = receiveValue - sendValue;
  const denominator = Math.max(1, (sendValue + receiveValue) / 2);
  return {
    sendValue,
    receiveValue,
    difference,
    percentageDifference: Math.abs(difference) / denominator,
  };
}

export function tradePackages(
  players: TradePlayer[],
  maxSize = TRADE_SEARCH_LIMITS.maxPackageSize,
  requiredPlayerId?: string | null,
) {
  if (requiredPlayerId) {
    const required = players.find((player) => player.id === requiredPlayerId);
    if (!required) return [];
    const results: TradePlayer[][] = [[required]];
    if (maxSize >= 2) {
      for (const player of players)
        if (player.id !== required.id) results.push([required, player]);
    }
    return results;
  }
  const results: TradePlayer[][] = players.map((player) => [player]);
  if (maxSize >= 2) {
    for (let left = 0; left < players.length; left += 1) {
      for (let right = left + 1; right < players.length; right += 1)
        results.push([players[left], players[right]]);
    }
  }
  return results;
}

interface ValuedPackage {
  players: TradePlayer[];
  value: number;
}

function valuedPackages(players: TradePlayer[][]): ValuedPackage[] {
  return players
    .map((items) => ({
      players: items,
      value: items.reduce((sum, player) => sum + (player.value ?? 0), 0),
    }))
    .sort((left, right) => left.value - right.value);
}

function lowerBound(packages: ValuedPackage[], value: number) {
  let low = 0;
  let high = packages.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (packages[middle].value < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function closeValuePackages(
  packages: ValuedPackage[],
  target: number,
  window: number,
) {
  // percentageDifference = abs(a-b) / max(1, (a+b)/2). Solve the
  // inequality once, then binary-search the sorted package values.
  const ratio = window / 2;
  const minimum = (target * (1 - ratio)) / (1 + ratio);
  const maximum = (target * (1 + ratio)) / Math.max(0.001, 1 - ratio);
  const start = lowerBound(packages, minimum);
  const matches: ValuedPackage[] = [];
  for (
    let index = start;
    index < packages.length && packages[index].value <= maximum;
    index += 1
  ) {
    matches.push(packages[index]);
  }
  return matches;
}

function projectedLineup(roster: TradePlayer[], rosterPositions: string[]) {
  return optimizeProjectedLineup(
    roster.map((player) => ({
      playerId: player.id,
      position: player.position,
      projectedPpg: player.projectedPpg,
    })),
    rosterPositions,
  ).projectedPpg;
}

function afterTrade(
  roster: TradePlayer[],
  outgoing: TradePlayer[],
  incoming: TradePlayer[],
) {
  const outgoingIds = new Set(outgoing.map((player) => player.id));
  return [
    ...roster.filter((player) => !outgoingIds.has(player.id)),
    ...incoming,
  ];
}

function needScore(roster: TradePlayer[], incoming: TradePlayer[]) {
  const strength = new Map<string, number>();
  for (const player of roster)
    strength.set(
      player.position ?? "OTHER",
      Math.max(
        strength.get(player.position ?? "OTHER") ?? 0,
        player.value ?? 0,
      ),
    );
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
  const myCandidates = options.myRoster
    .filter((player) => (player.value ?? 0) >= 1)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, TRADE_SEARCH_LIMITS.playersPerTeam);
  const outgoingPackages = tradePackages(
    myCandidates,
    TRADE_SEARCH_LIMITS.maxPackageSize,
    options.specificPlayerId,
  );
  const currentMyLineup = projectedLineup(
    options.myRoster,
    options.rosterPositions,
  );
  const seen = new Set<string>();
  const candidates: Array<
    Omit<TradeSuggestion, "lineupDelta" | "score"> & { baseScore: number }
  > = [];
  for (const otherRoster of options.otherRosters) {
    const incomingCandidates = otherRoster
      .filter((player) => (player.value ?? 0) >= 1)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      .slice(0, TRADE_SEARCH_LIMITS.playersPerTeam);
    const incomingPackages = valuedPackages(tradePackages(incomingCandidates));
    for (const send of outgoingPackages) {
      const sendValue = send.reduce(
        (sum, player) => sum + (player.value ?? 0),
        0,
      );
      for (const receivedPackage of closeValuePackages(
        incomingPackages,
        sendValue,
        options.valueWindow ?? TRADE_SEARCH_LIMITS.valueWindow,
      )) {
        const receive = receivedPackage.players;
        const key =
          send
            .map((player) => player.id)
            .sort()
            .join("+") +
          "->" +
          receive
            .map((player) => player.id)
            .sort()
            .join("+");
        if (seen.has(key)) continue;
        seen.add(key);
        const totals = tradeTotals(send, receive);
        if (
          totals.percentageDifference >
          (options.valueWindow ?? TRADE_SEARCH_LIMITS.valueWindow)
        )
          continue;
        const baseScore =
          100 -
          totals.percentageDifference * 100 +
          needScore(options.myRoster, receive);
        candidates.push({ ...totals, send, receive, baseScore });
      }
    }
  }
  const suggestions = candidates
    .sort(
      (left, right) =>
        right.baseScore - left.baseScore ||
        Math.abs(left.difference) - Math.abs(right.difference),
    )
    .slice(0, TRADE_SEARCH_LIMITS.maxResults * 4)
    .map(({ baseScore, ...candidate }): TradeSuggestion => {
      const lineupDelta =
        projectedLineup(
          afterTrade(options.myRoster, candidate.send, candidate.receive),
          options.rosterPositions,
        ) - currentMyLineup;
      return { ...candidate, lineupDelta, score: baseScore + lineupDelta * 2 };
    });
  return suggestions
    .sort(
      (left, right) =>
        right.score - left.score ||
        Math.abs(left.difference) - Math.abs(right.difference),
    )
    .slice(0, TRADE_SEARCH_LIMITS.maxResults);
}
