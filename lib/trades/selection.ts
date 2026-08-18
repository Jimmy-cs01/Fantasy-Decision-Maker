export function toggleTradePlayerId(selected: string[], playerId: string) {
  return selected.includes(playerId)
    ? selected.filter((id) => id !== playerId)
    : [...selected, playerId];
}
