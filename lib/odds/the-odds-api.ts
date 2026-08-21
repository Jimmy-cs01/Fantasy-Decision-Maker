import { calculateImpliedTeamTotals } from "./implied-totals";
import { normalizeNflTeam } from "../nfl/teams";
import type { OddsProvider } from "./provider";
import type { OddsGame, OddsQuota, PlayerProp } from "./types";

export const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
export const NFL_SPORT_KEY = "americanfootball_nfl";
export const FEATURED_MARKETS = ["h2h", "spreads", "totals"] as const;
export const PLAYER_PROP_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_pass_attempts",
  "player_pass_completions",
  "player_pass_interceptions",
  "player_rush_yds",
  "player_rush_attempts",
  "player_rush_tds",
  "player_receptions",
  "player_reception_yds",
  "player_reception_tds",
  "player_anytime_td",
] as const;

interface ApiOutcome { name?: unknown; description?: unknown; price?: unknown; point?: unknown }
interface ApiMarket { key?: unknown; last_update?: unknown; outcomes?: unknown }
interface ApiBookmaker { key?: unknown; last_update?: unknown; markets?: unknown }
interface ApiEvent { id?: unknown; commence_time?: unknown; home_team?: unknown; away_team?: unknown; bookmakers?: unknown }

const text = (value: unknown) => typeof value === "string" ? value : null;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const outcomes = (market: ApiMarket | undefined) => Array.isArray(market?.outcomes) ? market.outcomes as ApiOutcome[] : [];
const markets = (book: ApiBookmaker) => new Map(
  (Array.isArray(book.markets) ? book.markets as ApiMarket[] : [])
    .flatMap((market) => text(market.key) ? [[text(market.key)!, market] as const] : []),
);

export function parseQuotaHeaders(headers: Pick<Headers, "get">): OddsQuota {
  const parse = (name: string) => {
    const value = headers.get(name);
    return value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  return {
    requestsUsed: parse("x-requests-used"),
    requestsRemaining: parse("x-requests-remaining"),
    requestsLast: parse("x-requests-last"),
  };
}

function marketOutcome(market: ApiMarket | undefined, name: string) {
  return outcomes(market).find((outcome) => text(outcome.name) === name);
}

export function parseFeaturedOdds(payload: unknown, season: number, week: number): OddsGame[] {
  if (!Array.isArray(payload)) throw new Error("The Odds API returned a malformed games response.");
  return (payload as ApiEvent[]).flatMap((event) => {
    const externalGameId = text(event.id);
    const commenceTime = text(event.commence_time);
    const homeName = text(event.home_team);
    const awayName = text(event.away_team);
    const homeTeam = homeName ? normalizeNflTeam(homeName) : null;
    const awayTeam = awayName ? normalizeNflTeam(awayName) : null;
    if (!externalGameId || !commenceTime || !homeName || !awayName || !homeTeam || !awayTeam) return [];
    const books = Array.isArray(event.bookmakers) ? event.bookmakers as ApiBookmaker[] : [];
    return books.flatMap((book): OddsGame[] => {
      const sportsbook = text(book.key);
      if (!sportsbook) return [];
      const byKey = markets(book);
      const homeSpread = number(marketOutcome(byKey.get("spreads"), homeName)?.point);
      const gameTotal = number(marketOutcome(byKey.get("totals"), "Over")?.point);
      const homeMoneyline = number(marketOutcome(byKey.get("h2h"), homeName)?.price);
      const awayMoneyline = number(marketOutcome(byKey.get("h2h"), awayName)?.price);
      if ([homeSpread, gameTotal, homeMoneyline, awayMoneyline].every((value) => value === null)) return [];
      const implied = homeSpread !== null && gameTotal !== null
        ? calculateImpliedTeamTotals(gameTotal, homeSpread)
        : null;
      return [{
        externalGameId, season, week, homeTeam, awayTeam, commenceTime,
        homeSpread, gameTotal, homeMoneyline, awayMoneyline,
        homeImpliedTotal: implied?.home ?? null,
        awayImpliedTotal: implied?.away ?? null,
        provider: "the-odds-api",
        sportsbook,
        capturedAt: text(book.last_update) ?? commenceTime,
      }];
    });
  });
}

export function parsePlayerProps(payload: unknown): PlayerProp[] {
  const event = payload as ApiEvent;
  const externalGameId = text(event?.id);
  if (!externalGameId) throw new Error("The Odds API returned a malformed player-props response.");
  const books = Array.isArray(event.bookmakers) ? event.bookmakers as ApiBookmaker[] : [];
  return books.flatMap((book): PlayerProp[] => {
    const sportsbook = text(book.key);
    if (!sportsbook) return [];
    return [...markets(book)].flatMap(([marketKey, market]): PlayerProp[] => {
      if (!(PLAYER_PROP_MARKETS as readonly string[]).includes(marketKey)) return [];
      const grouped = new Map<string, ApiOutcome[]>();
      for (const outcome of outcomes(market)) {
        const outcomeName = text(outcome.name);
        const playerName = text(outcome.description)
          ?? (marketKey === "player_anytime_td" && outcomeName && !["Yes", "No"].includes(outcomeName) ? outcomeName : null);
        if (!playerName) continue;
        grouped.set(playerName, [...(grouped.get(playerName) ?? []), outcome]);
      }
      return [...grouped.entries()].flatMap(([playerName, selections]) => {
        const over = selections.find((selection) => text(selection.name) === "Over" || text(selection.name) === "Yes")
          ?? (marketKey === "player_anytime_td" ? selections[0] : undefined);
        const under = selections.find((selection) => text(selection.name) === "Under" || text(selection.name) === "No");
        const line = number(over?.point) ?? number(under?.point) ?? (marketKey === "player_anytime_td" ? 0.5 : null);
        if (line === null) return [];
        return [{
          playerName, externalGameId, market: marketKey, line,
          overOdds: number(over?.price), underOdds: number(under?.price),
          provider: "the-odds-api", sportsbook,
          capturedAt: text(market.last_update) ?? text(book.last_update) ?? new Date().toISOString(),
        }];
      });
    });
  });
}

export class TheOddsApiProvider implements OddsProvider {
  readonly name = "the-odds-api";
  quota: OddsQuota = { requestsUsed: null, requestsRemaining: null, requestsLast: null };

  constructor(
    private readonly apiKey = process.env.ODDS_API_KEY,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, params: Record<string, string>) {
    if (!this.apiKey) throw new Error("ODDS_API_KEY is not configured.");
    const url = new URL(`${ODDS_API_BASE}${path}`);
    Object.entries({ ...params, apiKey: this.apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetcher(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
        this.quota = parseQuotaHeaders(response.headers);
        if (!response.ok) throw new Error(`The Odds API request failed (${response.status}).`);
        return await response.json();
      } catch (error) {
        lastError = error;
        if (attempt === 0) continue;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("The Odds API request failed.");
  }

  async getGames(season: number, week: number) {
    const payload = await this.request(`/sports/${NFL_SPORT_KEY}/odds`, {
      regions: "us", markets: FEATURED_MARKETS.join(","), oddsFormat: "american", dateFormat: "iso",
    });
    return parseFeaturedOdds(payload, season, week);
  }

  async getPlayerPropsForEvent(eventId: string, marketKeys: readonly string[] = PLAYER_PROP_MARKETS) {
    const payload = await this.request(`/sports/${NFL_SPORT_KEY}/events/${encodeURIComponent(eventId)}/odds`, {
      regions: "us", markets: marketKeys.join(","), oddsFormat: "american", dateFormat: "iso",
    });
    return parsePlayerProps(payload);
  }
}
