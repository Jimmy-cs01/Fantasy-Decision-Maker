import {
  optimizeProjectedLineup,
  type LineupAssignment,
} from "../player-values/lineup";
import {
  isTradeEvaluationSupportedSlot,
  tradeEvaluationRosterPositions,
} from "./lineup-slots";

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
  depthRole?: string | null;
}

export interface TeamTradeImpact {
  lineupBefore: number;
  lineupAfter: number;
  starterPpgDelta: number;
  starterPpgComponent: number;
  depthBefore: number;
  depthAfter: number;
  depthDelta: number;
  marginalDepthDelta: number;
  marginalDepthComponent: number;
  assetValueDelta: number;
  assetValueComponent: number;
  consolidationAdjustment: number;
  positionalNeedAdjustment: number;
  rosterCapacityAdjustment: number;
  rosterHoleAdjustment: number;
  droppedPlayerIds: string[];
  freedRosterSlots: number;
  completeBefore: boolean;
  completeAfter: boolean;
  promotedStarterIds: string[];
  demotedStarterIds: string[];
  lineupChanges: LineupChanges;
  lineupNotes: string[];
  effectiveDelta: number;
  finalTradeFit: number;
}

export interface LineupChangePlayer {
  playerId: string;
  name: string;
  position: string | null;
  slot: string | null;
}

export interface LineupMove extends LineupChangePlayer {
  fromSlot: string;
  toSlot: string;
}

export interface LineupChanges {
  promoted: LineupChangePlayer[];
  demoted: LineupChangePlayer[];
  outgoingStarters: LineupChangePlayer[];
  incomingStarters: LineupChangePlayer[];
  benchReplacements: LineupChangePlayer[];
  incomingBench: LineupChangePlayer[];
  movedStarters: LineupMove[];
  unfilledSlots: string[];
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
  packageComplexityAdjustment: number;
  tradeShape: TradeShape;
  finalTradeFit: number;
  rawTradeFit: number;
  recommendationShapeAdjustment?: number;
  finalRecommendationScore?: number;
  scoreComponents: {
    my: TradeFitComponents;
    opponent: TradeFitComponents;
    packageComplexityAdjustment: number;
    finalTradeFit: number;
  };
  reasons: string[];
  score: number;
}

export interface TradeFitComponents {
  starterPpgDelta: number;
  assetValueDelta: number;
  marginalDepthDelta: number;
  consolidationAdjustment: number;
  positionalNeedAdjustment: number;
  rosterCapacityAdjustment: number;
  finalTradeFit: number;
}

export type TradeShape = "1-for-1" | "2-for-2" | "3-for-3" | "1-for-2" | "2-for-1" | "2-for-3" | "3-for-2" | "other";

export const TRADE_SEARCH_LIMITS = {
  playersPerTeam: 12,
  maxPackageSize: 3,
  threePlayerPool: 8,
  finalistsPerShape: 2,
  finalistsPerOpponent: 12,
  maxResults: 20,
  maxResultsPerOpponent: 2,
  valueWindow: 0.28,
  shapeDiversityCloseness: 1.5,
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

const DEPTH_SLOT_WEIGHTS = [0.11, 0.035, 0.01] as const;

export function calculateMarginalDepthUtility(roster: TradePlayer[], starterIds: string[]) {
  const starters = new Set(starterIds);
  const byPosition = new Map<string, TradePlayer[]>();
  for (const player of roster.filter(
    (item) =>
      !starters.has(item.id) &&
      isTradeEvaluationSupportedSlot(item.position),
  )) {
    const position = player.position?.toUpperCase() ?? "OTHER";
    byPosition.set(position, [...(byPosition.get(position) ?? []), player]);
  }
  let total = 0;
  for (const players of byPosition.values()) {
    players.sort((left, right) => {
      const ppg = (right.projectedPpg ?? 0) - (left.projectedPpg ?? 0);
      return ppg || (right.value ?? 0) - (left.value ?? 0) || left.id.localeCompare(right.id);
    });
    total += players.slice(0, DEPTH_SLOT_WEIGHTS.length).reduce((positionTotal, player, index) => {
      const usableProduction = Math.max(0, (player.projectedPpg ?? 0) - 2);
      const assetSupport = Math.max(0, Math.min(30, player.value ?? 0)) * 0.04;
      return positionTotal + (usableProduction + assetSupport) * DEPTH_SLOT_WEIGHTS[index];
    }, 0);
  }
  return total;
}

function rosterCapacity(roster: TradePlayer[], rosterPositions: string[]) {
  const configured = rosterPositions.filter((slot) => !["IR", "TAXI"].includes(slot.trim().toUpperCase())).length;
  return Math.max(roster.length, configured);
}

function dropUtility(player: TradePlayer) {
  return (player.projectedPpg ?? 0) + (player.value ?? 0) * 0.08;
}

function enforceRosterCapacity(roster: TradePlayer[], capacity: number, rosterPositions: string[]) {
  let retained = [...roster];
  const dropped: TradePlayer[] = [];
  while (retained.length > capacity) {
    const currentLineup = lineup(retained, rosterPositions);
    const starters = new Set(currentLineup.selectedPlayerIds);
    const droppable = retained.filter((player) => !starters.has(player.id));
    const pool = droppable.length ? droppable : retained;
    const weakest = [...pool].sort((left, right) =>
      dropUtility(left) - dropUtility(right) || left.id.localeCompare(right.id))[0];
    dropped.push(weakest);
    retained = retained.filter((player) => player.id !== weakest.id);
  }
  return { roster: retained, dropped };
}

function positionalNeed(roster: TradePlayer[], incoming: TradePlayer[]) {
  const topByPosition = new Map<string, number>();
  for (const player of roster.filter((item) =>
    isTradeEvaluationSupportedSlot(item.position),
  )) {
    const position = player.position ?? "OTHER";
    topByPosition.set(position, Math.max(topByPosition.get(position) ?? 0, player.projectedPpg ?? 0));
  }
  return clamp(incoming.filter((player) =>
    isTradeEvaluationSupportedSlot(player.position),
  ).reduce((total, player) => {
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
  return round(clamp(slotsFreed * quality * 0.15 * leagueFactor, 0, 2));
}

function impactForTeam(options: {
  roster: TradePlayer[];
  outgoing: TradePlayer[];
  incoming: TradePlayer[];
  rosterPositions: string[];
  leagueTeams: number;
}): TeamTradeImpact {
  const evaluationPositions = tradeEvaluationRosterPositions(
    options.rosterPositions,
  );
  const before = lineup(options.roster, evaluationPositions);
  const capacity = rosterCapacity(options.roster, evaluationPositions);
  const uncappedAfterRoster = afterTrade(options.roster, options.outgoing, options.incoming);
  const capacityResult = enforceRosterCapacity(
    uncappedAfterRoster,
    capacity,
    evaluationPositions,
  );
  const afterRoster = capacityResult.roster;
  const after = lineup(afterRoster, evaluationPositions);
  const beforeIds = new Set(before.selectedPlayerIds);
  const afterIds = new Set(after.selectedPlayerIds);
  const depthBefore = calculateMarginalDepthUtility(options.roster, before.selectedPlayerIds);
  const depthAfter = calculateMarginalDepthUtility(afterRoster, after.selectedPlayerIds);
  const supportedAssetValue = (roster: TradePlayer[]) =>
    roster
      .filter((player) => isTradeEvaluationSupportedSlot(player.position))
      .reduce((sum, player) => sum + (player.value ?? 0), 0);
  const assetValueDelta = supportedAssetValue(afterRoster)
    - supportedAssetValue(options.roster);
  const starterPpgDelta = after.projectedPpg - before.projectedPpg;
  const depthDelta = depthAfter - depthBefore;
  const retainedIds = new Set(afterRoster.map((player) => player.id));
  const retainedIncoming = options.incoming.filter(
    (player) =>
      retainedIds.has(player.id) &&
      isTradeEvaluationSupportedSlot(player.position),
  );
  const consolidation = consolidationAdjustment(
    options.roster, options.outgoing, retainedIncoming, before.selectedPlayerIds, options.leagueTeams,
  );
  const need = positionalNeed(options.roster, retainedIncoming);
  const incomingIds = new Set(options.incoming.map((player) => player.id));
  const displacedExistingValue = capacityResult.dropped
    .filter(
      (player) =>
        !incomingIds.has(player.id) &&
        isTradeEvaluationSupportedSlot(player.position),
    )
    .reduce((sum, player) => sum + (player.value ?? 0), 0);
  const freedRosterSlots = Math.max(0, capacity - afterRoster.length);
  const capacityAdjustment = round(clamp(
    freedRosterSlots * 0.15 - displacedExistingValue * 0.03,
    -1.25,
    0.4,
  ));
  const rosterHoleAdjustment = before.complete && !after.complete ? -12 : 0;
  const starterPpgComponent = starterPpgDelta * 4.5;
  const marginalDepthComponent = depthDelta * 0.65;
  const assetValueComponent = clamp(assetValueDelta * 0.1, -7, 7);
  const effectiveDelta = starterPpgComponent + marginalDepthComponent + assetValueComponent
    + consolidation + need + capacityAdjustment + rosterHoleAdjustment;
  const promotedStarterIds = [...afterIds].filter((id) => !beforeIds.has(id));
  const demotedStarterIds = [...beforeIds].filter((id) => !afterIds.has(id));
  const lineupChanges = describeLineupChanges({
    before,
    after,
    beforeRoster: options.roster,
    afterRoster,
    outgoing: options.outgoing,
    incoming: retainedIncoming,
    rosterPositions: evaluationPositions,
    promotedStarterIds,
    demotedStarterIds,
  });
  return {
    lineupBefore: before.projectedPpg,
    lineupAfter: after.projectedPpg,
    starterPpgDelta: round(starterPpgDelta),
    starterPpgComponent: round(starterPpgComponent),
    depthBefore: round(depthBefore),
    depthAfter: round(depthAfter),
    depthDelta: round(depthDelta),
    marginalDepthDelta: round(depthDelta),
    marginalDepthComponent: round(marginalDepthComponent),
    assetValueDelta: round(assetValueDelta),
    assetValueComponent: round(assetValueComponent),
    consolidationAdjustment: consolidation,
    positionalNeedAdjustment: round(need),
    rosterCapacityAdjustment: capacityAdjustment,
    rosterHoleAdjustment,
    droppedPlayerIds: capacityResult.dropped.map((player) => player.id),
    freedRosterSlots,
    completeBefore: before.complete,
    completeAfter: after.complete,
    promotedStarterIds,
    demotedStarterIds,
    lineupChanges,
    lineupNotes: lineupChangeNotes(lineupChanges),
    effectiveDelta: round(effectiveDelta),
    finalTradeFit: round(effectiveDelta),
  };
}

function normalizedSlot(slot: string) {
  const normalized = slot.trim().toUpperCase();
  if (["SUPER_FLEX", "SUPERFLEX", "SF"].includes(normalized)) return "SUPERFLEX";
  if (["FLEX", "WRT", "WRRB_FLEX", "REC_FLEX"].includes(normalized)) return "FLEX";
  return normalized;
}

function lineupSlotLabel(rosterPositions: string[], slot: string, slotIndex: number) {
  const normalized = normalizedSlot(slot);
  const matching = rosterPositions
    .map((item, index) => ({ item: normalizedSlot(item), index }))
    .filter((item) => item.item === normalized);
  if (matching.length <= 1) return normalized;
  const occurrence = matching.findIndex((item) => item.index === slotIndex) + 1;
  return `${normalized}${Math.max(1, occurrence)}`;
}

function describeLineupChanges(options: {
  before: ReturnType<typeof optimizeProjectedLineup>;
  after: ReturnType<typeof optimizeProjectedLineup>;
  beforeRoster: TradePlayer[];
  afterRoster: TradePlayer[];
  outgoing: TradePlayer[];
  incoming: TradePlayer[];
  rosterPositions: string[];
  promotedStarterIds: string[];
  demotedStarterIds: string[];
}): LineupChanges {
  const beforePlayers = new Map(options.beforeRoster.map((player) => [player.id, player]));
  const afterPlayers = new Map(options.afterRoster.map((player) => [player.id, player]));
  const beforeAssignments = new Map(options.before.assignments.map((assignment) => [assignment.playerId, assignment]));
  const afterAssignments = new Map(options.after.assignments.map((assignment) => [assignment.playerId, assignment]));
  const outgoingIds = new Set(options.outgoing.map((player) => player.id));
  const incomingIds = new Set(options.incoming.map((player) => player.id));
  const promotedIds = new Set(options.promotedStarterIds);
  const demotedIds = new Set(options.demotedStarterIds);
  const changePlayer = (
    player: TradePlayer,
    assignment: LineupAssignment | undefined,
  ): LineupChangePlayer => ({
    playerId: player.id,
    name: player.name,
    position: player.position,
    slot: assignment
      ? lineupSlotLabel(options.rosterPositions, assignment.slot, assignment.slotIndex)
      : null,
  });
  const promoted = [...promotedIds]
    .flatMap((id) => {
      const player = afterPlayers.get(id);
      return player ? [changePlayer(player, afterAssignments.get(id))] : [];
    });
  const demoted = [...demotedIds]
    .flatMap((id) => {
      const player = beforePlayers.get(id);
      return player ? [changePlayer(player, beforeAssignments.get(id))] : [];
    });
  const outgoingStarters = options.outgoing
    .filter((player) => beforeAssignments.has(player.id))
    .map((player) => changePlayer(player, beforeAssignments.get(player.id)));
  const incomingStarters = options.incoming
    .filter((player) => afterAssignments.has(player.id))
    .map((player) => changePlayer(player, afterAssignments.get(player.id)));
  const benchReplacements = promoted.filter((player) => !incomingIds.has(player.playerId));
  const incomingBench = options.incoming
    .filter((player) => !afterAssignments.has(player.id))
    .map((player) => changePlayer(player, undefined));
  const movedStarters = [...afterAssignments.entries()].flatMap(([playerId, afterAssignment]) => {
    const beforeAssignment = beforeAssignments.get(playerId);
    const player = afterPlayers.get(playerId);
    if (!beforeAssignment || !player || outgoingIds.has(playerId)) return [];
    const fromSlot = lineupSlotLabel(options.rosterPositions, beforeAssignment.slot, beforeAssignment.slotIndex);
    const toSlot = lineupSlotLabel(options.rosterPositions, afterAssignment.slot, afterAssignment.slotIndex);
    return fromSlot === toSlot ? [] : [{ ...changePlayer(player, afterAssignment), fromSlot, toSlot }];
  });
  return {
    promoted,
    demoted,
    outgoingStarters,
    incomingStarters,
    benchReplacements,
    incomingBench,
    movedStarters,
    unfilledSlots: options.after.unfilledSlots.map((slot) =>
      lineupSlotLabel(options.rosterPositions, slot.slot, slot.slotIndex)),
  };
}

function lineupChangeNotes(changes: LineupChanges) {
  const notes = [
    ...changes.unfilledSlots.map((slot) => `No projected starter is available for ${slot}`),
    ...changes.incomingStarters.map((player) => `${player.name} enters ${player.slot ?? "the starting lineup"}`),
    ...changes.benchReplacements.map((player) => `${player.name} moves from the bench into ${player.slot ?? "the starting lineup"}`),
    ...changes.incomingBench.map((player) => `${player.name} remains on bench`),
    ...changes.outgoingStarters.map((player) => `${player.name} leaves ${player.slot ?? "the starting lineup"}`),
    ...changes.movedStarters.map((player) => `${player.name} moves from ${player.fromSlot} to ${player.toSlot}`),
    ...changes.demoted
      .filter((player) => !changes.outgoingStarters.some((outgoing) => outgoing.playerId === player.playerId))
      .map((player) => `${player.name} moves to the bench`),
  ];
  return [...new Set(notes)];
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
  const tradeShape = packageShape(options.send.length, options.receive.length);
  const packageComplexityAdjustment = packageComplexityAdjustmentFor(tradeShape);
  const finalTradeFit = round(
    (myImpact.effectiveDelta + opponentImpact.effectiveDelta) * 0.25
      + packageComplexityAdjustment,
  );
  const components = (impact: TeamTradeImpact): TradeFitComponents => ({
    starterPpgDelta: impact.starterPpgDelta,
    assetValueDelta: impact.assetValueDelta,
    marginalDepthDelta: impact.marginalDepthDelta,
    consolidationAdjustment: impact.consolidationAdjustment,
    positionalNeedAdjustment: impact.positionalNeedAdjustment,
    rosterCapacityAdjustment: impact.rosterCapacityAdjustment,
    finalTradeFit: impact.finalTradeFit,
  });
  const reasons: string[] = [];
  if (myImpact.starterPpgDelta > 0.4) reasons.push(`You gain ${myImpact.starterPpgDelta.toFixed(1)} projected starter PPG`);
  if (opponentImpact.starterPpgDelta > 0.4) reasons.push(`Opponent gains ${opponentImpact.starterPpgDelta.toFixed(1)} projected starter PPG`);
  if (myImpact.consolidationAdjustment > 0) reasons.push("You consolidate multiple assets into a stronger lineup slot");
  if (opponentImpact.consolidationAdjustment > 0) reasons.push("Opponent consolidates multiple assets into a stronger lineup slot");
  if (myImpact.depthDelta < -0.5) reasons.push("You lose meaningful bench depth");
  if (opponentImpact.depthDelta > 0.5) reasons.push("Opponent gains usable roster depth");
  if (myImpact.droppedPlayerIds.length) reasons.push(`Roster capacity displaces ${myImpact.droppedPlayerIds.length} player${myImpact.droppedPlayerIds.length === 1 ? "" : "s"}`);
  const opponentIncomingStarters = opponentImpact.promotedStarterIds.filter((id) => options.send.some((player) => player.id === id)).length;
  if (options.send.length > 1 && opponentIncomingStarters < options.send.length) {
    reasons.push(`Only ${opponentIncomingStarters} of ${options.send.length} incoming players enters the opponent lineup`);
  }
  if (!myImpact.completeAfter || !opponentImpact.completeAfter) reasons.push("Trade creates an unfilled starting-lineup slot");
  if (!reasons.length) reasons.push("Comparable roster-adjusted value with limited lineup movement");
  return {
    ...totals,
    send: options.send,
    receive: options.receive,
    lineupDelta: myImpact.starterPpgDelta,
    myImpact,
    opponentImpact,
    tradeFairnessScore,
    packageComplexityAdjustment,
    tradeShape,
    finalTradeFit,
    rawTradeFit: finalTradeFit,
    scoreComponents: {
      my: components(myImpact),
      opponent: components(opponentImpact),
      packageComplexityAdjustment,
      finalTradeFit,
    },
    reasons: reasons.slice(0, 3),
  };
}

export function supportedAutomaticTradeShape(sendSize: number, receiveSize: number) {
  return (sendSize <= 2 && receiveSize <= 2)
    || (sendSize === 2 && receiveSize === 3)
    || (sendSize === 3 && receiveSize === 2)
    || (sendSize === 3 && receiveSize === 3);
}

function packageShape(sendSize: number, receiveSize: number): TradeShape {
  const shape = `${sendSize}-for-${receiveSize}`;
  return ["1-for-1", "2-for-2", "3-for-3", "1-for-2", "2-for-1", "2-for-3", "3-for-2"].includes(shape)
    ? shape as TradeShape
    : "other";
}

function packageComplexityAdjustmentFor(shape: TradeShape) {
  const adjustments: Record<TradeShape, number> = {
    "1-for-1": 0,
    "2-for-2": -0.05,
    "3-for-3": -0.25,
    "1-for-2": -0.45,
    "2-for-1": -0.45,
    "2-for-3": -1.25,
    "3-for-2": -1.25,
    other: -1.5,
  };
  return adjustments[shape];
}

export function diversifyTradeSuggestions(suggestions: TradeSuggestion[], limit = TRADE_SEARCH_LIMITS.maxResults) {
  const groups = new Map<string, TradeSuggestion[]>();
  for (const suggestion of [...suggestions].sort((left, right) => right.score - left.score)) {
    groups.set(suggestion.opponentTeamId, [...(groups.get(suggestion.opponentTeamId) ?? []), suggestion]);
  }
  const selectedByOpponent = new Map<string, TradeSuggestion[]>();
  const selectedShapeCounts = new Map<TradeShape, number>();
  for (const [opponentId, group] of groups) {
    const best = group[0];
    selectedByOpponent.set(opponentId, [{
      ...best,
      recommendationShapeAdjustment: 0,
      finalRecommendationScore: best.score,
    }]);
    selectedShapeCounts.set(best.tradeShape, (selectedShapeCounts.get(best.tradeShape) ?? 0) + 1);
  }
  for (const [opponentId, group] of groups) {
    const choices = selectedByOpponent.get(opponentId)!;
    const best = choices[0];
    const remaining = group.slice(1);
    if (remaining.length && choices.length < TRADE_SEARCH_LIMITS.maxResultsPerOpponent) {
      const strongestRemaining = remaining[0];
      const alternateShape = remaining
        .filter((candidate) =>
          candidate.tradeShape !== best.tradeShape
            && candidate.score >= strongestRemaining.score - TRADE_SEARCH_LIMITS.shapeDiversityCloseness)
        .sort((left, right) =>
          (selectedShapeCounts.get(left.tradeShape) ?? 0) - (selectedShapeCounts.get(right.tradeShape) ?? 0)
            || right.score - left.score)[0];
      const choice = alternateShape ?? strongestRemaining;
      const recommendationShapeAdjustment = round(Math.max(0, strongestRemaining.score - choice.score));
      choices.push({
        ...choice,
        recommendationShapeAdjustment,
        finalRecommendationScore: round(choice.score + recommendationShapeAdjustment),
      });
      selectedShapeCounts.set(choice.tradeShape, (selectedShapeCounts.get(choice.tradeShape) ?? 0) + 1);
    }
  }
  const selected: TradeSuggestion[] = [];
  for (let roundIndex = 0; roundIndex < TRADE_SEARCH_LIMITS.maxResultsPerOpponent; roundIndex += 1) {
    for (const group of selectedByOpponent.values()) {
      if (selected.length >= limit) return selected;
      if (group[roundIndex]) selected.push(group[roundIndex]);
    }
  }
  return selected;
}

function boundedCandidatePackages(players: TradePlayer[], requiredPlayerId?: string | null) {
  const oneAndTwo = tradePackages(players, 2, requiredPlayerId);
  let threePlayerPool = players.slice(0, TRADE_SEARCH_LIMITS.threePlayerPool);
  if (requiredPlayerId && !threePlayerPool.some((player) => player.id === requiredPlayerId)) {
    const required = players.find((player) => player.id === requiredPlayerId);
    if (required) threePlayerPool = [...threePlayerPool.slice(0, TRADE_SEARCH_LIMITS.threePlayerPool - 1), required];
  }
  return [...oneAndTwo, ...tradePackages(threePlayerPool, 3, requiredPlayerId).filter((items) => items.length === 3)];
}

function retainBestCandidate<T extends { preliminary: number }>(candidates: T[], candidate: T) {
  candidates.push(candidate);
  candidates.sort((left, right) => right.preliminary - left.preliminary);
  if (candidates.length > TRADE_SEARCH_LIMITS.finalistsPerShape) candidates.length = TRADE_SEARCH_LIMITS.finalistsPerShape;
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
    .filter(
      (player) =>
        (player.value ?? 0) >= 1 &&
        isTradeEvaluationSupportedSlot(player.position),
    )
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
    .slice(0, TRADE_SEARCH_LIMITS.playersPerTeam);
  const outgoingPackages = boundedCandidatePackages(candidates(options.myRoster), options.specificPlayerId);
  const valueWindow = options.valueWindow ?? TRADE_SEARCH_LIMITS.valueWindow;
  const finalists: Array<{ opponentRoster: TradePlayer[]; send: TradePlayer[]; receive: TradePlayer[]; preliminary: number }> = [];

  for (const opponentRoster of options.otherRosters) {
    const incomingPackages = valuedPackages(boundedCandidatePackages(candidates(opponentRoster)));
    const opponentCandidatesByShape = new Map<TradeShape, typeof finalists>();
    const seen = new Set<string>();
    for (const send of outgoingPackages) {
      const sendValue = send.reduce((sum, player) => sum + (player.value ?? 0), 0);
      for (const incoming of closeValuePackages(incomingPackages, sendValue, valueWindow)) {
        if (!supportedAutomaticTradeShape(send.length, incoming.players.length)) continue;
        const key = `${send.map((player) => player.id).sort().join("+")}->${incoming.players.map((player) => player.id).sort().join("+")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const totals = tradeTotals(send, incoming.players);
        if (totals.percentageDifference > valueWindow) continue;
        const shape = packageShape(send.length, incoming.players.length);
        const candidate = {
          opponentRoster, send, receive: incoming.players,
          preliminary: 100 - totals.percentageDifference * 100
            + positionalNeed(options.myRoster, incoming.players)
            + positionalNeed(opponentRoster, send)
            + packageComplexityAdjustmentFor(shape),
        };
        const shapeCandidates = opponentCandidatesByShape.get(shape) ?? [];
        retainBestCandidate(shapeCandidates, candidate);
        opponentCandidatesByShape.set(shape, shapeCandidates);
      }
    }
    finalists.push(...[...opponentCandidatesByShape.values()].flat()
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
      score: evaluation.tradeFairnessScore + evaluation.finalTradeFit,
    };
  }).filter((suggestion) => suggestion.tradeFairnessScore >= 45);
  return diversifyTradeSuggestions(scored, TRADE_SEARCH_LIMITS.maxResults);
}
