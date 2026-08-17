export function calculateImpliedTeamTotals(gameTotal: number, homeSpread: number) {
  if (!Number.isFinite(gameTotal) || gameTotal < 0 || !Number.isFinite(homeSpread)) {
    throw new Error("Game total and home spread must be finite, with a non-negative total.");
  }
  return {
    home: gameTotal / 2 - homeSpread / 2,
    away: gameTotal / 2 + homeSpread / 2,
  };
}

