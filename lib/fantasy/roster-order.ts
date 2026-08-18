export const STARTER_SLOT_PRIORITY = ["QB", "RB", "WR", "TE", "SUPERFLEX", "FLEX", "K"] as const;
const BENCH_POSITION_PRIORITY = ["QB", "RB", "WR", "TE", "K"] as const;
const NON_STARTER_SLOTS = new Set(["BN", "BENCH", "IR", "TAXI"]);

export function normalizeLineupSlot(slot: string | null | undefined) {
  const normalized = String(slot ?? "").trim().toUpperCase();
  if (normalized === "SUPER_FLEX" || normalized === "SUPER FLEX") return "SUPERFLEX";
  if (normalized === "REC_FLEX" || normalized === "WRRB_FLEX" || normalized === "WRRBTE_FLEX") return "FLEX";
  return normalized;
}

export function starterSlots(rosterPositions: string[]) {
  return rosterPositions.map(normalizeLineupSlot).filter((slot) => slot && !NON_STARTER_SLOTS.has(slot));
}

export function assignStarterSlots(starterEntries: Array<string | null>, rosterPositions: string[]) {
  const slots = starterSlots(rosterPositions);
  const assignments = new Map<string, { rosterSlot: string; rosterSlotIndex: number }>();
  starterEntries.forEach((playerId, index) => {
    if (playerId && playerId !== "0") assignments.set(playerId, { rosterSlot: slots[index] ?? "STARTER", rosterSlotIndex: index });
  });
  return assignments;
}

export interface OrderedRosterPlayer {
  full_name: string;
  position: string | null;
  is_starter: boolean;
  roster_slot: string | null;
  roster_slot_index: number | null;
}

const priority = (value: string | null, order: readonly string[]) => {
  const index = order.indexOf(normalizeLineupSlot(value));
  return index === -1 ? order.length : index;
};

export function orderRosterPlayers<T extends OrderedRosterPlayer>(players: T[]) {
  return [...players].sort((left, right) => {
    if (left.is_starter !== right.is_starter) return left.is_starter ? -1 : 1;
    if (left.is_starter) {
      return priority(left.roster_slot, STARTER_SLOT_PRIORITY)
        - priority(right.roster_slot, STARTER_SLOT_PRIORITY)
        || (left.roster_slot_index ?? Number.MAX_SAFE_INTEGER) - (right.roster_slot_index ?? Number.MAX_SAFE_INTEGER)
        || left.full_name.localeCompare(right.full_name);
    }
    return priority(left.position, BENCH_POSITION_PRIORITY)
      - priority(right.position, BENCH_POSITION_PRIORITY)
      || left.full_name.localeCompare(right.full_name);
  });
}

export interface LeagueTeamOption {
  id: string;
  name: string | null;
  sleeper_roster_id: number | null;
  provider_team_id?: string | null;
  league_member_id: string | null;
  ownerName?: string | null;
  isMyTeam?: boolean;
}

export function selectLeagueTeam<T extends LeagueTeamOption>(teams: T[], requestedTeamId: string | null, personalMemberId: string | null) {
  const personal = teams.find((team) => team.league_member_id === personalMemberId);
  return teams.find((team) => team.id === requestedTeamId) ?? personal ?? teams[0] ?? null;
}
