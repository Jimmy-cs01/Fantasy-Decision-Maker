export type ScoringSettings = Record<string, number>;
export function calculateFantasyPoints(stats: Record<string, number>, settings: ScoringSettings) { return Object.entries(stats).reduce((total, [stat, value]) => total + value * (settings[stat] ?? 0), 0); }
