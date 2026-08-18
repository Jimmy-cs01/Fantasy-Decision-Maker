import type { YahooLeague, YahooLeagueSettings, YahooRaw, YahooRosterPlayer, YahooTeam } from "./types";

const object = (value: unknown): YahooRaw | null => value && typeof value === "object" && !Array.isArray(value) ? value as YahooRaw : null;
const text = (value: unknown) => value == null ? "" : String(value);
const number = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };

export function mergeYahooEntity(value: unknown): YahooRaw {
  if (Array.isArray(value)) return value.reduce<YahooRaw>((merged, item) => ({ ...merged, ...mergeYahooEntity(item) }), {});
  const source = object(value);
  if (!source) return {};
  const merged: YahooRaw = {};
  for (const [key, item] of Object.entries(source)) {
    if (/^\d+$/.test(key)) Object.assign(merged, mergeYahooEntity(item));
    else merged[key] = item;
  }
  return merged;
}

export function findYahooEntities(payload: unknown, identityKey: string): YahooRaw[] {
  const found = new Map<string, YahooRaw>();
  const visit = (node: unknown) => {
    const merged = mergeYahooEntity(node);
    if (merged[identityKey] != null) {
      const key = text(merged[identityKey]); const previous = found.get(key);
      if (!previous || Object.keys(merged).length > Object.keys(previous).length) found.set(key, merged);
    }
    if (Array.isArray(node)) node.forEach(visit);
    else if (object(node)) Object.values(node as YahooRaw).forEach(visit);
  };
  visit(payload);
  return [...found.values()];
}

export function normalizeYahooLeagues(payload: unknown): YahooLeague[] {
  return findYahooEntities(payload, "league_key").map((raw) => ({
    leagueKey: text(raw.league_key), name: text(raw.name) || "Yahoo league",
    season: Number(raw.season), numTeams: number(raw.num_teams), scoringType: raw.scoring_type == null ? null : text(raw.scoring_type), raw,
  })).filter((league) => league.leagueKey && Number.isInteger(league.season));
}

export function normalizeYahooTeams(payload: unknown): YahooTeam[] {
  return findYahooEntities(payload, "team_key").map((raw) => {
    const managers = findYahooEntities(raw.managers, "manager_id")[0] ?? {};
    const standings = mergeYahooEntity(raw.team_standings);
    const outcome = mergeYahooEntity(standings.outcome_totals);
    return { teamKey: text(raw.team_key), teamId: text(raw.team_id), name: text(raw.name) || "Yahoo team",
      managerId: managers.manager_id == null ? null : text(managers.manager_id), managerName: managers.nickname == null ? null : text(managers.nickname),
      wins: number(outcome.wins), losses: number(outcome.losses), ties: number(outcome.ties), raw };
  });
}

const positionMap: Record<string, string> = { "W/R/T": "FLEX", "W/R": "FLEX", "Q/W/R/T": "SUPER_FLEX", BN: "BN", IR: "IR", DEF: "DEF" };
export const normalizeYahooRosterPosition = (position: string) => positionMap[position.toUpperCase()] ?? position.toUpperCase();

export function normalizeYahooRoster(payload: unknown): YahooRosterPlayer[] {
  return findYahooEntities(payload, "player_key").map((raw) => {
    const name = mergeYahooEntity(raw.name);
    const selected = mergeYahooEntity(raw.selected_position);
    const selectedPosition = normalizeYahooRosterPosition(text(selected.position || "BN"));
    return { playerKey: text(raw.player_key), playerId: text(raw.player_id), name: text(name.full || raw.name),
      position: raw.display_position == null ? null : text(raw.display_position).split(",")[0], team: raw.editorial_team_abbr == null ? null : text(raw.editorial_team_abbr),
      selectedPosition, isStarter: !["BN", "IR", "NA"].includes(selectedPosition), raw };
  });
}

// Yahoo football stat IDs. Unknown rules remain preserved for audit rather than
// being silently approximated.
const scoringMap: Record<string, string> = {
  "1": "pass_att", "2": "pass_cmp", "4": "pass_yd", "5": "pass_td", "6": "pass_int", "8": "rush_att",
  "9": "rush_yd", "10": "rush_td", "11": "rec", "12": "rec_yd", "13": "rec_td",
};

export function normalizeYahooSettings(payload: unknown): YahooLeagueSettings {
  const merged = findYahooEntities(payload, "roster_positions")[0] ?? mergeYahooEntity(payload);
  const rosterRows = findYahooEntities(merged.roster_positions, "position");
  const rosterPositions = rosterRows.flatMap((row) => Array(Math.max(0, Number(row.count ?? 1))).fill(normalizeYahooRosterPosition(text(row.position))));
  const modifiers = findYahooEntities(merged.stat_modifiers, "stat_id");
  const scoringSettings: Record<string, number> = {};
  const unsupportedScoring: Array<{ statId: string; value: number }> = [];
  for (const modifier of modifiers) {
    const statId = text(modifier.stat_id); const value = number(modifier.value);
    if (value == null) continue;
    const key = scoringMap[statId];
    if (key) scoringSettings[key] = value; else unsupportedScoring.push({ statId, value });
  }
  return { rosterPositions, scoringSettings, unsupportedScoring, raw: merged };
}
