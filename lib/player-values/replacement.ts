import type { FantasyPosition, PositionReplacementProfile, ValueLeagueConfig, ValuePlayerProjection } from "./types";

export const VALUE_POSITIONS: FantasyPosition[] = ["QB", "RB", "WR", "TE"];

export function slotEligibility(slot: string): FantasyPosition[] {
  const normalized = slot.trim().toUpperCase().replaceAll(" ", "_");
  if (VALUE_POSITIONS.includes(normalized as FantasyPosition)) return [normalized as FantasyPosition];
  if (["SUPER_FLEX", "SUPERFLEX", "OP"].includes(normalized)) return ["QB", "RB", "WR", "TE"];
  if (["REC_FLEX", "WR_TE_FLEX"].includes(normalized)) return ["WR", "TE"];
  if (["WRRB_FLEX", "WR_RB_FLEX"].includes(normalized)) return ["RB", "WR"];
  if (["FLEX", "WRT", "WRRBTE_FLEX"].includes(normalized)) return ["RB", "WR", "TE"];
  return [];
}

export function calculatePositionDemand(pool: ValuePlayerProjection[], config: ValueLeagueConfig) {
  const demand = Object.fromEntries(VALUE_POSITIONS.map((position) => [position, 0])) as Record<FantasyPosition, number>;
  const flexSlots: FantasyPosition[][] = [];
  for (const slot of config.rosterPositions) {
    const eligible = slotEligibility(slot);
    if (eligible.length === 1) demand[eligible[0]] += config.teams;
    else if (eligible.length > 1) {
      for (let team = 0; team < config.teams; team += 1) flexSlots.push(eligible);
    }
  }

  const used = new Set<string>();
  for (const position of VALUE_POSITIONS) {
    pool.filter((player) => player.position === position)
      .sort((left, right) => right.projectedPpg - left.projectedPpg || left.playerId.localeCompare(right.playerId))
      .slice(0, demand[position])
      .forEach((player) => used.add(player.playerId));
  }

  flexSlots.sort((left, right) => left.length - right.length || left.join().localeCompare(right.join()));
  for (const eligible of flexSlots) {
    const candidate = pool.filter((player) => eligible.includes(player.position) && !used.has(player.playerId))
      .sort((left, right) => right.projectedPpg - left.projectedPpg || left.playerId.localeCompare(right.playerId))[0];
    if (!candidate) continue;
    used.add(candidate.playerId);
    demand[candidate.position] += 1;
  }

  const benchSlots = config.rosterPositions.filter((slot) => ["BN", "BENCH"].includes(slot.trim().toUpperCase())).length;
  const benchDemand = benchSlots * config.teams;
  const starterDemand = { ...demand };
  const starterTotal = Math.max(1, Object.values(starterDemand).reduce((sum, count) => sum + count, 0));
  const allocations = VALUE_POSITIONS.map((position) => {
    const quota = benchDemand * starterDemand[position] / starterTotal;
    return { position, count: Math.floor(quota), remainder: quota - Math.floor(quota) };
  });
  for (let remaining = benchDemand - allocations.reduce((sum, item) => sum + item.count, 0); remaining > 0; remaining -= 1) {
    allocations.sort((left, right) => right.remainder - left.remainder || left.position.localeCompare(right.position));
    allocations[0].count += 1;
    allocations[0].remainder = -1;
  }
  for (const allocation of allocations) demand[allocation.position] += allocation.count;
  return demand;
}

const valueAt = (players: ValuePlayerProjection[], index: number) => players[Math.min(Math.max(index, 0), players.length - 1)]?.projectedPpg ?? 0;

export function calculateReplacementProfiles(pool: ValuePlayerProjection[], config: ValueLeagueConfig) {
  const demand = calculatePositionDemand(pool, config);
  return Object.fromEntries(VALUE_POSITIONS.map((position) => {
    const players = pool.filter((player) => player.position === position)
      .sort((left, right) => right.projectedPpg - left.projectedPpg || left.playerId.localeCompare(right.playerId));
    const demandedPlayers = demand[position];
    const eliteCount = Math.max(1, Math.ceil(config.teams * 0.2));
    const elitePpg = players.slice(0, eliteCount).reduce((sum, player) => sum + player.projectedPpg, 0) / Math.max(1, Math.min(eliteCount, players.length));
    const replacementPpg = valueAt(players, demandedPlayers);
    const starterPpg = valueAt(players, Math.ceil(demandedPlayers / 2) - 1);
    const profile: PositionReplacementProfile = {
      position,
      demandedPlayers,
      replacementPpg,
      starterPpg,
      elitePpg,
      scarcityDropoff: Math.max(0, elitePpg - replacementPpg),
      demandPerTeam: demandedPlayers / Math.max(1, config.teams),
    };
    return [position, profile];
  })) as Record<FantasyPosition, PositionReplacementProfile>;
}
