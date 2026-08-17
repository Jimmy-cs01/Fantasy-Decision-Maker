import { calculatePlayerValue } from "../lib/player-values/formula";
import type {
  PositionReplacementProfile,
  ValuePlayerProjection,
} from "../lib/player-values/types";

const profile: PositionReplacementProfile = {
  position: "RB",
  demandedPlayers: 36,
  replacementPpg: 7.4,
  starterPpg: 12,
  elitePpg: 18,
  scarcityDropoff: 10.6,
  demandPerTeam: 3.6,
};
const base: ValuePlayerProjection = {
  playerId: "archetype",
  fullName: "Young RB archetype",
  position: "RB",
  season: 2026,
  projectedPpg: 14,
  floorPpg: 9.6,
  ceilingPpg: 18.2,
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
    depthRank: 1,
  },
  {
    ...base,
    playerId: "round-2-rb2",
    fullName: "Round 2 RB2",
    draftStatus: "drafted",
    draftRound: 2,
    depthRank: 2,
  },
  {
    ...base,
    playerId: "round-4-rb3",
    fullName: "Round 4 RB3",
    draftStatus: "drafted",
    draftRound: 4,
    depthRank: 3,
  },
  {
    ...base,
    playerId: "round-7-rb4",
    fullName: "Round 7 RB4",
    draftStatus: "drafted",
    draftRound: 7,
    depthRank: 4,
  },
  {
    ...base,
    playerId: "frank-gore-jr",
    fullName: "Frank Gore Jr. profile (UDFA RB4)",
    draftStatus: "undrafted",
    draftRound: null,
    depthRank: 4,
  },
  {
    ...base,
    playerId: "promoted-udfa",
    fullName: "Young UDFA promoted to RB2",
    draftStatus: "undrafted",
    draftRound: null,
    depthRank: 2,
  },
];

console.table(
  cases.map((player) => {
    const value = calculatePlayerValue(player, profile, 17);
    return {
      archetype: player.fullName,
      value: value.value,
      floor: value.floorValue,
      ceiling: value.ceilingValue,
      opportunityConfidence: value.opportunityConfidence,
      ageContext: value.ageAdjustment,
      draftContext: value.draftAdjustment,
      roleContext: value.depthAdjustment,
    };
  }),
);
