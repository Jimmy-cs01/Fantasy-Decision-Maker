import { slotEligibility } from "./replacement";

export interface LineupPlayer {
  playerId: string;
  position: string | null;
  projectedPpg: number | null;
}

export interface OptimalLineupResult {
  projectedPpg: number;
  selectedPlayerIds: string[];
  filledSlots: number;
  requiredSlots: number;
  complete: boolean;
}

export function optimizeProjectedLineup(players: LineupPlayer[], rosterPositions: string[]): OptimalLineupResult {
  const slots = rosterPositions.map((slot) => ({ slot, eligible: lineupSlotEligibility(slot) })).filter((slot) => slot.eligible.length > 0);
  if (!slots.length) return { projectedPpg: 0, selectedPlayerIds: [], filledSlots: 0, requiredSlots: 0, complete: true };
  const candidates = players.filter((player) => player.projectedPpg !== null && player.position).sort((left, right) => left.playerId.localeCompare(right.playerId));
  let states = new Map<number, { points: number; playerIds: string[] }>([[0, { points: 0, playerIds: [] }]]);
  for (const player of candidates) {
    const position = player.position!.toUpperCase();
    const next = new Map(states);
    for (const [mask, state] of states) {
      slots.forEach((slot, index) => {
        const bit = 1 << index;
        if ((mask & bit) || !slot.eligible.includes(position)) return;
        const newMask = mask | bit;
        const points = state.points + Number(player.projectedPpg);
        const existing = next.get(newMask);
        const playerIds = [...state.playerIds, player.playerId].sort();
        if (!existing || points > existing.points || (points === existing.points && playerIds.join().localeCompare(existing.playerIds.join()) < 0)) {
          next.set(newMask, { points, playerIds });
        }
      });
    }
    states = next;
  }
  const best = [...states.entries()].sort(([leftMask, left], [rightMask, right]) => {
    const leftFilled = bitCount(leftMask); const rightFilled = bitCount(rightMask);
    return rightFilled - leftFilled || right.points - left.points || left.playerIds.join().localeCompare(right.playerIds.join());
  })[0];
  const filledSlots = bitCount(best[0]);
  return {
    projectedPpg: Math.round(best[1].points * 10) / 10,
    selectedPlayerIds: best[1].playerIds,
    filledSlots,
    requiredSlots: slots.length,
    complete: filledSlots === slots.length,
  };
}

function lineupSlotEligibility(slot: string): string[] {
  const fantasy = slotEligibility(slot);
  if (fantasy.length) return fantasy;
  const normalized = slot.trim().toUpperCase();
  if (normalized === "K") return ["K"];
  if (["DEF", "DST"].includes(normalized)) return ["DEF", "DST"];
  return [];
}

function bitCount(input: number) {
  let value = input; let count = 0;
  while (value) { count += value & 1; value >>>= 1; }
  return count;
}
