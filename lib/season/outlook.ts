export interface SeasonTeamInput {
  id: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  projectedPpg: number;
  projectionSd: number;
  rosterValue: number;
  allPlayWinPct?: number | null;
}

export interface SeasonMatchup {
  week: number;
  teamAId: string;
  teamBId: string;
}

export const POWER_RANKING_WEIGHTS = {
  currentPerformance: 0.35,
  projectedLineup: 0.3,
  rosterStrength: 0.2,
  scheduleContext: 0.15,
} as const;

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const winPct = (team: SeasonTeamInput) => {
  const games = team.wins + team.losses + team.ties;
  return games ? (team.wins + team.ties * 0.5) / games : 0.5;
};
const normalize = (values: number[]) => {
  const minimum = Math.min(...values); const maximum = Math.max(...values);
  if (!Number.isFinite(minimum) || maximum === minimum) return values.map(() => 0.5);
  return values.map((value) => (value - minimum) / (maximum - minimum));
};

export function calculatePowerRankings(teams: SeasonTeamInput[], schedule: SeasonMatchup[]) {
  const winScores = normalize(teams.map(winPct));
  const pointScores = normalize(teams.map((team) => team.pointsFor));
  const allPlayScores = normalize(teams.map((team) => team.allPlayWinPct ?? winPct(team)));
  const lineupScores = normalize(teams.map((team) => team.projectedPpg));
  const rosterScores = normalize(teams.map((team) => team.rosterValue));
  const byId = new Map(teams.map((team) => [team.id, team]));
  const opponentStrength = teams.map((team) => {
    const opponents = schedule.flatMap((matchup) => matchup.teamAId === team.id ? [byId.get(matchup.teamBId)?.projectedPpg ?? 0] : matchup.teamBId === team.id ? [byId.get(matchup.teamAId)?.projectedPpg ?? 0] : []);
    return opponents.length ? opponents.reduce((sum, value) => sum + value, 0) / opponents.length : teams.reduce((sum, item) => sum + item.projectedPpg, 0) / Math.max(1, teams.length);
  });
  const opponentScores = normalize(opponentStrength).map((value) => 1 - value);
  return teams.map((team, index) => {
    const currentPerformance = winScores[index] * 0.55 + pointScores[index] * 0.25 + allPlayScores[index] * 0.2;
    const score = 100 * (
      currentPerformance * POWER_RANKING_WEIGHTS.currentPerformance
      + lineupScores[index] * POWER_RANKING_WEIGHTS.projectedLineup
      + rosterScores[index] * POWER_RANKING_WEIGHTS.rosterStrength
      + opponentScores[index] * POWER_RANKING_WEIGHTS.scheduleContext
    );
    return { ...team, powerScore: Math.round(score * 10) / 10, remainingScheduleStrength: opponentStrength[index] };
  }).sort((left, right) => right.powerScore - left.powerScore || right.projectedPpg - left.projectedPpg || left.id.localeCompare(right.id))
    .map((team, index) => ({ ...team, rank: index + 1 }));
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function normal(random: () => number, mean: number, standardDeviation: number) {
  const left = Math.max(Number.EPSILON, random());
  const right = random();
  return mean + Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right) * standardDeviation;
}

export function simulatePlayoffChances(options: {
  teams: SeasonTeamInput[];
  schedule: SeasonMatchup[];
  playoffTeams: number;
  simulations?: number;
  seed?: number;
}) {
  const simulations = Math.max(100, options.simulations ?? 5_000);
  const playoffTeams = Math.max(1, Math.min(options.playoffTeams, options.teams.length));
  const random = seededRandom(options.seed ?? 2026);
  const appearances = new Map(options.teams.map((team) => [team.id, 0]));
  const inputs = new Map(options.teams.map((team) => [team.id, team]));
  for (let run = 0; run < simulations; run += 1) {
    const standings = new Map(options.teams.map((team) => [team.id, { wins: team.wins, losses: team.losses, ties: team.ties, pointsFor: team.pointsFor }]));
    for (const matchup of options.schedule) {
      const teamA = inputs.get(matchup.teamAId); const teamB = inputs.get(matchup.teamBId);
      const rowA = standings.get(matchup.teamAId); const rowB = standings.get(matchup.teamBId);
      if (!teamA || !teamB || !rowA || !rowB) continue;
      const scoreA = Math.max(0, normal(random, teamA.projectedPpg, Math.max(8, teamA.projectionSd)));
      const scoreB = Math.max(0, normal(random, teamB.projectedPpg, Math.max(8, teamB.projectionSd)));
      rowA.pointsFor += scoreA; rowB.pointsFor += scoreB;
      if (Math.abs(scoreA - scoreB) < 0.01) { rowA.ties += 1; rowB.ties += 1; }
      else if (scoreA > scoreB) { rowA.wins += 1; rowB.losses += 1; }
      else { rowB.wins += 1; rowA.losses += 1; }
    }
    [...standings.entries()].sort(([leftId, left], [rightId, right]) =>
      right.wins - left.wins || right.ties - left.ties || right.pointsFor - left.pointsFor || leftId.localeCompare(rightId),
    ).slice(0, playoffTeams).forEach(([id]) => appearances.set(id, (appearances.get(id) ?? 0) + 1));
  }
  return new Map([...appearances].map(([id, count]) => [id, Math.round(count / simulations * 1000) / 10]));
}

export function buildFallbackSchedule(teamIds: string[], gamesRemaining: number, startWeek: number) {
  if (teamIds.length < 2 || gamesRemaining <= 0) return [];
  const ids = teamIds.length % 2 ? [...teamIds, "BYE"] : [...teamIds];
  const rounds: SeasonMatchup[] = [];
  let rotating = [...ids];
  for (let offset = 0; offset < gamesRemaining; offset += 1) {
    for (let index = 0; index < rotating.length / 2; index += 1) {
      const teamAId = rotating[index]; const teamBId = rotating[rotating.length - 1 - index];
      if (teamAId !== "BYE" && teamBId !== "BYE") rounds.push({ week: startWeek + offset, teamAId, teamBId });
    }
    rotating = [rotating[0], rotating.at(-1)!, ...rotating.slice(1, -1)];
  }
  return rounds;
}
