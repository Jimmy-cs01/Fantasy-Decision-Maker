import { calculatePlayerValue } from "../lib/player-values/formula";
import type {
  PositionReplacementProfile,
  ValuePlayerProjection,
} from "../lib/player-values/types";

const profiles: Record<ValuePlayerProjection["position"], PositionReplacementProfile> = {
  RB: { position: "RB", demandedPlayers: 36, replacementPpg: 7.4, starterPpg: 12, elitePpg: 18, scarcityDropoff: 10.6, demandPerTeam: 3.6 },
  WR: { position: "WR", demandedPlayers: 48, replacementPpg: 7, starterPpg: 11, elitePpg: 17, scarcityDropoff: 10, demandPerTeam: 4.8 },
  QB: { position: "QB", demandedPlayers: 14, replacementPpg: 15, starterPpg: 18, elitePpg: 24, scarcityDropoff: 9, demandPerTeam: 1.4 },
  TE: { position: "TE", demandedPlayers: 14, replacementPpg: 6, starterPpg: 9, elitePpg: 14, scarcityDropoff: 8, demandPerTeam: 1.4 },
};
const base: ValuePlayerProjection = {
  playerId: "archetype",
  fullName: "Young RB archetype",
  position: "RB",
  season: 2026,
  rookieSeason: 2026,
  projectedPpg: 7,
  floorPpg: 3,
  ceilingPpg: 13,
  confidence: "low",
  birthDate: "2002-03-13",
  historicalGames: 0,
};
const cases: ValuePlayerProjection[] = [
  {
    ...base,
    playerId: "round-1-rb1",
    fullName: "Round 1 RB1",
    draftStatus: "drafted",
    draftRound: 1,
    draftPick: 8,
    depthRank: 1,
  },
  {
    ...base,
    playerId: "round-1-wr1",
    fullName: "Round 1 WR1",
    position: "WR",
    draftStatus: "drafted",
    draftRound: 1,
    draftPick: 8,
    depthRank: 1,
  },
  {
    ...base,
    playerId: "round-1-qb1",
    fullName: "Round 1 starting QB",
    position: "QB",
    draftStatus: "drafted",
    draftRound: 1,
    draftPick: 3,
    depthRank: 1,
  },
  {
    ...base,
    playerId: "round-3-rb2",
    fullName: "Day 2 RB2",
    draftStatus: "drafted",
    draftRound: 3,
    draftPick: 75,
    depthRank: 2,
  },
  {
    ...base,
    playerId: "round-5-rb3",
    fullName: "Day 3 RB3",
    draftStatus: "drafted",
    draftRound: 5,
    draftPick: 150,
    depthRank: 3,
  },
  {
    ...base,
    playerId: "udfa-rb1",
    fullName: "Undrafted RB1",
    draftStatus: "undrafted",
    draftRound: null,
    depthRank: 1,
  },
  {
    ...base,
    playerId: "buried-round-1-rb",
    fullName: "Round 1 RB buried at RB4",
    draftStatus: "drafted",
    draftRound: 1,
    draftPick: 20,
    depthRank: 4,
  },
];

console.table(
  cases.map((player) => {
    const baseline = calculatePlayerValue({ ...player, rookieSeason: null }, profiles[player.position], 17);
    const value = calculatePlayerValue(player, profiles[player.position], 17);
    return {
      archetype: player.fullName,
      baselineValue: baseline.fundamentalValue,
      protectedValue: value.fundamentalValue,
      valueChange: Math.round((value.fundamentalValue - baseline.fundamentalValue) * 10) / 10,
      production: value.productionValue,
      rookieProtectionPpg: value.rookieProtectionAdjustment,
      opportunityConfidence: value.opportunityConfidence,
    };
  }),
);
