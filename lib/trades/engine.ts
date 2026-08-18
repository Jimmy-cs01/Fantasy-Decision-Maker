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
  opponent?: string | null;
  isHome?: boolean | null;
  teamImpliedTotal?: number | null;
}

export interface TeamTradeImpact {
  lineupBefore: number;
  lineupAfter: number;
  starterPpgDelta: number;
  depthBefore: number;
  depthAfter: number;
  depthDelta: number;
  assetValueDelta: number;
  consolidationAdjustment: number;
  positionalNeedAdjustment: number;
  completeBefore: boolean;
  completeAfter: boolean;
  promotedStarterIds: string[];
  demotedStarterIds: string[];
  effectiveDelta: number;
}

export interface TradeSuggestion {
  opponentTeamId: string;
  send: TradePlayer[];
  receive: TradePlayer[];
  sendValue: number;
  receiveValue: number;
  difference: number;
  percentageDifference: number;
  lineupDelta: number;
  myImpact: TeamTradeImpact;
  opponentImpact: TeamTradeImpact;
  tradeFairnessScore: number;
  reasons: string[];
  score: number;
}

export const TRADE_SEARCH_LIMITS = {
  playersPerTeam: 12,
  maxPackageSize: 3,
  finalistsPerOpponent: 6,
  maxResults: 20,
  maxResultsPerOpponent: 2,
  valueWindow: 0.28,
} as const;

const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function tradeTotals(send: TradePlayer[], receive: TradePlayer[]) {
  const sendValue = send.reduce((sum, player) => sum + (player.value ?? 0), 0);
  const receiveValue = receive.reduce((sum, player) => sum + (player.value ?? 0), 0);
  const difference = receiveValue - sendValue;
  const denominator = Math.max(1, (sendValue + receiveValue) / 2);
  return { sendValue, receiveValue, difference, percentageDifference: Math.abs(difference) / denominator };
}

export function tradePackages(
  players: TradePlayer[],
  maxSize: number = TRADE_SEARCH_LIMITS.maxPackageSize,
  requiredPlayerId?: string | null,
) {
  const results: TradePlayer[][] = [];
  const build = (start: number, selected: TradePlayer[]) => {
    if (selected.length) {
      if (!requiredPlayerId || selected.some((player) => player.id === requiredPlayerId)) results.push(selected);
      if (selected.length === maxSize) return;
    }
    for (let index = start; index < players.length; index += 1) build(index + 1, [...selected, players[index]]);
  };
  if (requiredPlayerId && !players.some((player) => player.id === requiredPlayerId)) return [];
  build(0, []);
  return results;
}

interface ValuedPackage { players: TradePlayer[]; value: number }
function valuedPackages(packages: TradePlayer[][]): ValuedPackage[] {
  return packages.map((players) => ({
    players,
    value: players.reduce((sum, player) => sum + (player.value ?? 0), 0),
  })).sort((left, right) => left.value - right.value);
}

function lowerBound(packages: ValuedPackage[], value: number) {
  let low = 0; let high = packages.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (packages[middle].value < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function closeValuePackages(packages: ValuedPackage[], target: number, window: number) {
  const ratio = window / 2;
  const minimum = (target * (1 - ratio)) / (1 + ratio);
  const maximum = (target * (1 + ratio)) / Math.max(0.001, 1 - ratio);
  const start = lowerBound(packages, minimum);
  const matches: ValuedPackage[] = [];
  for (let index = start; index < packages.length && packages[index].value <= maximum; index += 1) matches.push(packages[index]);
  return matches;
}

function afterTrade(roster: TradePlayer[], outgoing: TradePlayer[], incoming: TradePlayer[]) {
  const outgoingIds = new Set(outgoing.map((player) => player.id));
  return [...roster.filter((player) => !outgoingIds.has(player.id)), ...incoming];
}

const lineupCache = new WeakMap<TradePlayer[], Map<string, ReturnType<typeof optimizeProjectedLineup>>>();
function lineup(roster: TradePlayer[], rosterPositions: string[]) {
  const key = rosterPositions.join("|");
  const cached = lineupCache.get(roster)?.get(key);
  if (cached) return cached;
  const result = optimizeProjectedLineup(
    roster.map((player) => ({ playerId: player.id, position: player.position, projectedPpg: player.projectedPpg })),
    rosterPositions,
  );
  const entries = lineupCache.get(roster) ?? new Map();
  entries.set(key, result);
  lineupCache.set(roster, entries);
  return result;
}

function depthScore(roster: TradePlayer[], starterIds: string[]) {
  const starters = new Set(starterIds);
  const weights = [0.2, 0.14, 0.09, 0.06, 0.04, 0.02];
  return roster.filter((player) => !starters.has(player.id))
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
    .slice(0, weights.length)
    .reduce((total, player, index) => total + (player.value ?? 0) * weights[index], 0);
}

function positionalNeed(roster: TradePlayer[], incoming: TradePlayer[]) {
  const topByPosition = new Map<string, number>();
  for (const player of roster) {
    const position = player.position ?? "OTHER";
    topByPosition.set(position, Math.max(topByPosition.get(position) ?? 0, player.projectedPpg ?? 0));
  }
  return clamp(incoming.reduce((total, player) => {
    const current = topByPosition.get(player.position ?? "OTHER") ?? 0;
    return total + Math.max(0, (player.projectedPpg ?? 0) - current) * 0.12;
  }, 0), 0, 2);
}

function consolidationAdjustment(
  beforeRoster: TradePlayer[],
  outgoing: TradePlayer[],
  incoming: TradePlayer[],
  starterIds: string[],
  leagueTeams: number,
) {
  const slotsFreed = Math.max(0, outgoing.length - incoming.length);
  if (!slotsFreed || !incoming.length) return 0;
  const starters = beforeRoster.filter((player) => starterIds.includes(player.id));
  const replacementStarter = starters.length ? Math.min(...starters.map((player) => player.projectedPpg ?? 0)) : 0;
  const bestIncoming = Math.max(...incoming.map((player) => player.projectedPpg ?? 0));
  const quality = Math.max(0, bestIncoming - replacementStarter);
  const leagueFactor = clamp(leagueTeams / 12, 0.75, 1.25);
  return round(clamp(slotsFreed * quality * 0.18 * leagueFactor, 0, 2.5));
}

function impactForTeam(options: {
  roster: TradePlayer[];
  outgoing: TradePlayer[];
  incoming: TradePlayer[];
  rosterPositions: string[];
  leagueTeams: number;
}): TeamTradeImpact {
  const before = lineup(options.roster, options.rosterPositions);
  const afterRoster = afterTrade(options.roster, options.outgoing, options.incoming);
  const after = lineup(afterRoster, options.rosterPositions);
  const beforeIds = new Set(before.selectedPlayerIds);
  const afterIds = new Set(after.selectedPlayerIds);
  const depthBefore = depthScore(options.roster, before.selectedPlayerIds);
  const depthAfter = depthScore(afterRoster, after.selectedPlayerIds);
  const assetValueDelta = options.incoming.reduce((sum, player) => sum + (player.value ?? 0), 0)
    - options.outgoing.reduce((sum, player) => sum + (player.value ?? 0), 0);
  const starterPpgDelta = after.projectedPpg - before.projectedPpg;
  const depthDelta = depthAfter - depthBefore;
  const consolidation = consolidationAdjustment(
    options.roster, options.outgoing, options.incoming, before.selectedPlayerIds, options.leagueTeams,
  );
  const need = positionalNeed(options.roster, options.incoming);
  const rosterHolePenalty = before.complete && !after.complete ? 10 : 0;
  const effectiveDelta = starterPpgDelta * 4 + depthDelta * 0.3 + assetValueDelta * 0.08
    + consolidation + need - rosterHolePenalty;
  return {
    lineupBefore: before.projectedPpg,
    lineupAfter: after.projectedPpg,
    starterPpgDelta: round(starterPpgDelta),
    depthBefore: round(depthBefore),
    depthAfter: round(depthAfter),
    depthDelta: round(depthDelta),
    assetValueDelta: round(assetValueDelta),
    consolidationAdjustment: consolidation,
    positionalNeedAdjustment: round(need),
    completeBefore: before.complete,
    completeAfter: after.complete,
    promotedStarterIds: [...afterIds].filter((id) => !beforeIds.has(id)),
    demotedStarterIds: [...beforeIds].filter((id) => !afterIds.has(id)),
    effectiveDelta: round(effectiveDelta),
  };
}

export function evaluateTrade(options: {
  myRoster: TradePlayer[];
  opponentRoster: TradePlayer[];
  send: TradePlayer[];
  receive: TradePlayer[];
  rosterPositions: string[];
  leagueTeams?: number;
}): Omit<TradeSuggestion, "opponentTeamId" | "score"> {
  const totals = tradeTotals(options.send, options.receive);
  const leagueTeams = options.leagueTeams ?? 10;
  const myImpact = impactForTeam({
    roster: options.myRoster, outgoing: options.send, incoming: options.receive,
    rosterPositions: options.rosterPositions, leagueTeams,
  });
  const opponentImpact = impactForTeam({
    roster: options.opponentRoster, outgoing: options.receive, incoming: options.send,
    rosterPositions: options.rosterPositions, leagueTeams,
  });
  const fairnessGap = Math.abs(myImpact.effectiveDelta - opponentImpact.effectiveDelta);
  const tradeFairnessScore = round(clamp(100 - fairnessGap * 7, 0, 100));
  const reasons: string[] = [];
  if (myImpact.starterPpgDelta > 0.4) reasons.push(`You gain ${myImpact.starterPpgDelta.toFixed(1)} projected starter PPG`);
  if (opponentImpact.starterPpgDelta > 0.4) reasons.push(`Opponent gains ${opponentImpact.starterPpgDelta.toFixed(1)} projected starter PPG`);
  if (myImpact.consolidationAdjustment > 0) reasons.push("You consolidate multiple assets into a stronger lineup slot");
  if (opponentImpact.consolidationAdjustment > 0) reasons.push("Opponent consolidates multiple assets into a stronger lineup slot");
  if (myImpact.depthDelta < -0.5) reasons.push("You lose meaningful bench depth");
  if (opponentImpact.depthDelta > 0.5) reasons.push("Opponent gains usable roster depth");
  const opponentIncomingStarters = opponentImpact.promotedStarterIds.filter((id) => options.send.some((player) => player.id === id)).length;
  if (options.send.length > 1 && opponentIncomingStarters < options.send.length) {
    reasons.push(`Only ${opponentIncomingStarters} of ${options.send.length} incoming players enters the opponent lineup`);
  }
  if (!myImpact.completeAfter || !opponentImpact.completeAfter) reasons.push("Trade creates an unfilled starting-lineup slot");
  if (!reasons.length) reasons.push("Comparable roster-adjusted value with limited lineup movement");
  return { ...totals, send: options.send, receive: options.receive, lineupDelta: myImpact.starterPpgDelta, myImpact, opponentImpact, tradeFairnessScore, reasons: reasons.slice(0, 3) };
}

function supportedPackagePair(sendSize: number, receiveSize: number) {
  return (sendSize <= 2 && receiveSize <= 2)
    || (sendSize === 2 && receiveSize === 3)
    || (sendSize === 3 && receiveSize === 2);
}

export function diversifyTradeSuggestions(suggestions: TradeSuggestion[], limit = TRADE_SEARCH_LIMITS.maxResults) {
  const groups = new Map<string, TradeSuggestion[]>();
  for (const suggestion of [...suggestions].sort((left, right) => right.score - left.score)) {
    groups.set(suggestion.opponentTeamId, [...(groups.get(suggestion.opponentTeamId) ?? []), suggestion]);
  }
  const selected: TradeSuggestion[] = [];
  for (let roundIndex = 0; roundIndex < TRADE_SEARCH_LIMITS.maxResultsPerOpponent; roundIndex += 1) {
    for (const group of groups.values()) {
      if (selected.length >= limit) return selected;
      if (group[roundIndex]) selected.push(group[roundIndex]);
    }
  }
  return selected;
}

export function findTradeSuggestions(options: {
  myRoster: TradePlayer[];
  otherRosters: TradePlayer[][];
  rosterPositions: string[];
  specificPlayerId?: string | null;
  valueWindow?: number;
  leagueTeams?: number;
}) {
  const candidates = (roster: TradePlayer[]) => roster
    .filter((player) => (player.value ?? 0) >= 1)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
    .slice(0, TRADE_SEARCH_LIMITS.playersPerTeam);
  const outgoingPackages = tradePackages(candidates(options.myRoster), 3, options.specificPlayerId);
  const valueWindow = options.valueWindow ?? TRADE_SEARCH_LIMITS.valueWindow;
  const finalists: Array<{ opponentRoster: TradePlayer[]; send: TradePlayer[]; receive: TradePlayer[]; preliminary: number }> = [];

  for (const opponentRoster of options.otherRosters) {
    const incomingPackages = valuedPackages(tradePackages(candidates(opponentRoster), 3));
    const opponentCandidates: typeof finalists = [];
    const seen = new Set<string>();
    for (const send of outgoingPackages) {
      const sendValue = send.reduce((sum, player) => sum + (player.value ?? 0), 0);
      for (const incoming of closeValuePackages(incomingPackages, sendValue, valueWindow)) {
        if (!supportedPackagePair(send.length, incoming.players.length)) continue;
        const key = `${send.map((player) => player.id).sort().join("+")}->${incoming.players.map((player) => player.id).sort().join("+")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const totals = tradeTotals(send, incoming.players);
        if (totals.percentageDifference > valueWindow) continue;
        opponentCandidates.push({
          opponentRoster, send, receive: incoming.players,
          preliminary: 100 - totals.percentageDifference * 100 + positionalNeed(options.myRoster, incoming.players),
        });
      }
    }
    finalists.push(...opponentCandidates
      .sort((left, right) => right.preliminary - left.preliminary)
      .slice(0, TRADE_SEARCH_LIMITS.finalistsPerOpponent));
  }

  const scored = finalists.map((candidate): TradeSuggestion => {
    const evaluation = evaluateTrade({
      myRoster: options.myRoster,
      opponentRoster: candidate.opponentRoster,
      send: candidate.send,
      receive: candidate.receive,
      rosterPositions: options.rosterPositions,
      leagueTeams: options.leagueTeams,
    });
    return {
      ...evaluation,
      opponentTeamId: candidate.opponentRoster[0]?.teamId ?? "unknown",
      score: evaluation.tradeFairnessScore + (evaluation.myImpact.effectiveDelta + evaluation.opponentImpact.effectiveDelta) * 0.25,
    };
  }).filter((suggestion) => suggestion.tradeFairnessScore >= 45);
  return diversifyTradeSuggestions(scored, TRADE_SEARCH_LIMITS.maxResults);
}
