import { slotEligibility } from "./replacement";

export interface LineupPlayer {
  playerId: string;
  position: string | null;
  projectedPpg: number | null;
}

export interface OptimalLineupResult {
  projectedPpg: number;
  selectedPlayerIds: string[];
  assignments: LineupAssignment[];
  unfilledSlots: LineupSlot[];
  filledSlots: number;
  requiredSlots: number;
  complete: boolean;
}

export interface LineupSlot {
  slot: string;
  slotIndex: number;
}

export interface LineupAssignment extends LineupSlot {
  playerId: string;
}

export function optimizeProjectedLineup(players: LineupPlayer[], rosterPositions: string[]): OptimalLineupResult {
  const slots = rosterPositions
    .map((slot, slotIndex) => ({ slot, slotIndex, eligible: lineupSlotEligibility(slot) }))
    .filter((slot) => slot.eligible.length > 0);
  if (!slots.length) return {
    projectedPpg: 0,
    selectedPlayerIds: [],
    assignments: [],
    unfilledSlots: [],
    filledSlots: 0,
    requiredSlots: 0,
    complete: true,
  };
  const candidates = players.filter((player) => player.projectedPpg !== null && player.position).sort((left, right) => left.playerId.localeCompare(right.playerId));
  let states = new Map<number, { points: number; assignments: LineupAssignment[] }>([[0, { points: 0, assignments: [] }]]);
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
        const assignments = [
          ...state.assignments,
          { playerId: player.playerId, slot: slot.slot, slotIndex: slot.slotIndex },
        ].sort((left, right) => left.slotIndex - right.slotIndex);
        if (!existing || points > existing.points || (points === existing.points && assignmentKey(assignments).localeCompare(assignmentKey(existing.assignments)) < 0)) {
          next.set(newMask, { points, assignments });
        }
      });
    }
    states = next;
  }
  const best = [...states.entries()].sort(([leftMask, left], [rightMask, right]) => {
    const leftFilled = bitCount(leftMask); const rightFilled = bitCount(rightMask);
    return rightFilled - leftFilled || right.points - left.points || assignmentKey(left.assignments).localeCompare(assignmentKey(right.assignments));
  })[0];
  const filledSlots = bitCount(best[0]);
  const assignments = best[1].assignments;
  return {
    projectedPpg: Math.round(best[1].points * 10) / 10,
    selectedPlayerIds: assignments.map((assignment) => assignment.playerId).sort(),
    assignments,
    unfilledSlots: slots
      .filter((_, index) => !(best[0] & (1 << index)))
      .map(({ slot, slotIndex }) => ({ slot, slotIndex })),
    filledSlots,
    requiredSlots: slots.length,
    complete: filledSlots === slots.length,
  };
}

function assignmentKey(assignments: LineupAssignment[]) {
  return assignments
    .map((assignment) => `${assignment.slotIndex}:${assignment.playerId}`)
    .join("|");
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
