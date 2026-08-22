import type { LeagueAnalyticsPlayer } from "@/lib/player-values/league-service";

export type WaiverAvailability = "free_agent" | "waiver" | "rostered";

export interface SleeperTransactionLike {
  type?: string | null;
  status?: string | null;
  adds?: Record<string, number | string | null> | null;
}

export interface WaiverWirePlayer extends LeagueAnalyticsPlayer {
  availability: WaiverAvailability;
}

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export function pendingWaiverPlayerIds(transactions: SleeperTransactionLike[]) {
  return new Set(
    transactions.flatMap((transaction) => {
      if (
        transaction.type?.toLowerCase() !== "waiver" ||
        transaction.status?.toLowerCase() !== "pending"
      ) return [];
      return Object.keys(transaction.adds ?? {});
    }),
  );
}

export function classifySleeperAvailability(input: {
  sleeperPlayerId: string | null;
  rosteredPlayerIds: Set<string>;
  pendingWaiverPlayerIds?: Set<string>;
}): WaiverAvailability {
  const id = input.sleeperPlayerId;
  if (id && input.rosteredPlayerIds.has(id)) return "rostered";
  if (id && input.pendingWaiverPlayerIds?.has(id)) return "waiver";
  return "free_agent";
}

export function buildWaiverWire(input: {
  projectionPool: LeagueAnalyticsPlayer[];
  rosteredPlayerIds: Iterable<string>;
  transactions?: SleeperTransactionLike[];
}) {
  const rosteredPlayerIds = new Set(input.rosteredPlayerIds);
  const pending = pendingWaiverPlayerIds(input.transactions ?? []);
  return input.projectionPool
    .flatMap((player): WaiverWirePlayer[] => {
      const position = player.position?.toUpperCase();
      if (!position || !FANTASY_POSITIONS.has(position)) return [];
      const availability = classifySleeperAvailability({
        sleeperPlayerId: player.sleeper_player_id,
        rosteredPlayerIds,
        pendingWaiverPlayerIds: pending,
      });
      return availability === "rostered" ? [] : [{ ...player, position, availability }];
    })
    .sort((left, right) =>
      Number(right.player_value ?? -1) - Number(left.player_value ?? -1) ||
      Number(right.projected_ppg ?? -1) - Number(left.projected_ppg ?? -1) ||
      left.full_name.localeCompare(right.full_name),
    );
}
