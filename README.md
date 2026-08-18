# Jimmy GM

A personal fantasy football analytics foundation for Sleeper and Yahoo leagues. It imports a private copy of a user's league data, displays a roster-first dashboard, and leaves clear seams for weekly NFL data and future decision-support features.

## Tech stack

- Next.js App Router, React, TypeScript, Tailwind CSS
- Supabase Auth and PostgreSQL
- Sleeper's public API and Yahoo's official Fantasy Sports API, accessed only from server code
- ESLint, Prettier, and Vitest

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Create a Supabase project, copy its URL and anon key into `.env.local`, then run the SQL migration below.

For local auth emails and callbacks, set `NEXT_PUBLIC_SITE_URL=http://localhost:3000` in `.env.local` (or `http://localhost:3001` when running that port). Production must set it explicitly to `https://jimmygm.com`.

## Environment variables

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=https://jimmygm.com # production; use localhost in .env.local
SUPABASE_SERVICE_ROLE_KEY= # server/admin importer only; never expose to browser code
ODDS_API_KEY= # optional server-only The Odds API key; never expose to browser code
YAHOO_CLIENT_ID= # server-only Yahoo application client ID
YAHOO_CLIENT_SECRET= # server-only Yahoo application secret
YAHOO_REDIRECT_URI=http://localhost:3000/api/yahoo/callback
YAHOO_TOKEN_ENCRYPTION_KEY= # 32 random bytes as hex or base64
```

The app uses the public URL, anon key, and one centralized canonical site origin. The historical importer additionally needs the service-role key. Never place a service-role key in a `NEXT_PUBLIC_` variable or print/commit it. Production deployment, DNS, Supabase Auth, and Resend SMTP instructions are in [`docs/production-deployment.md`](docs/production-deployment.md).

## Production domain and authentication email

`https://jimmygm.com` is the canonical production URL. Metadata, confirmation links, recovery links, and callback redirects all derive from `NEXT_PUBLIC_SITE_URL`; `www.jimmygm.com` is redirect-only. `/auth/callback` exchanges Supabase PKCE codes and accepts only internal return paths. `/auth` remains a compatibility redirect to the dedicated `/login` route.

Supabase Auth owns confirmation and password-recovery tokens. Resend is configured only as Supabase Custom SMTP with the intended sender `Jimmy GM <no-reply@jimmygm.com>`; the application has no Resend SDK or API key.

## Database and Supabase setup

1. Create a Supabase project and enable Email/Password sign-in in Authentication.
2. In the Supabase SQL editor, apply the files in [`supabase/migrations`](supabase/migrations) in timestamp order.
3. Add the project URL and anon key to `.env.local`.

The migration provides UUID internal IDs, separate Sleeper external IDs, constraints, indexes, timestamps, and Row Level Security. User-owned leagues, members, teams, rosters, and sync records can only be queried by their owner at the database layer.

## Sleeper integration

The `/dashboard/connect` flow validates a Sleeper username on the server, displays its current-season NFL leagues, and imports the selected league. Syncing fetches the league, members, rosters, and player directory, then upserts normalized records. Repeated synchronization updates the imported league rather than duplicating it.

Matchups and transactions are available through the client but intentionally are not imported yet—there is no dashboard use for them in this first version.

## Yahoo Fantasy integration

Yahoo support is a read-only provider adapter: OAuth discovers NFL leagues, then
imports league settings, teams, managers, roster slots, and conservatively mapped
canonical players. Tokens are encrypted with AES-256-GCM before the service-role-
only `yahoo_accounts` table stores them. Unknown Yahoo scoring rules are preserved
for audit, and ambiguous player identities remain unmapped rather than being
silently merged. Register **Jimmy GM** in Yahoo's Sports Developer portal with
`http://localhost:3000/api/yahoo/callback` locally and
`https://jimmygm.com/api/yahoo/callback` in production.

## Project structure

```text
app/                 Routes, server actions, and dashboard UI
components/          Reusable dashboard and UI components
lib/db/              Persistence and synchronization orchestration
lib/sleeper/         Sleeper HTTP client, API types, normalization
lib/yahoo/           Yahoo OAuth, provider adapter, normalization
lib/nfl/             Provider interface and mock implementation
lib/fantasy/         Scoring plus analytics extension points
supabase/migrations/ PostgreSQL schema and RLS policies
```

`NFLDataProvider` keeps future NFL statistics vendors behind an interface. The initial `MockNFLDataProvider` returns no data; future jobs can normalize weekly stats, store them, calculate league-specific points, and then calculate analytics without touching React components.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Historical data pipeline

```text
nflverse weekly player statistics
        ↓ trim / normalize
GSIS player identity
        ↓ reuse optional Sleeper identity mapping
processed historical weekly stats
        ↓ PostgreSQL / Supabase
internal feature engineering → fantasy value model
```

Sleeper is the league, roster, and current-identity source. nflverse is the single active NFL statistical source. Supabase stores normalized identities and weekly statistics. nflverse's GSIS `player_id` is the canonical historical external identity; internal UUIDs remain relational primary keys, and Sleeper IDs remain optional text mappings. Historical nflverse position and current Sleeper position are retained separately. Team is not an identity criterion because players change teams.

The official nflverse `stats_player` release provides a wider historical range, but this project intentionally uses 2012 onward. The downloader defaults to 2012 through the latest available season, validates existing files, and downloads only missing seasons. The ETL ignores any older source files that may already exist locally and validates the contiguous 2012+ range. Play-by-play coverage is a separate dataset and is not used to force earlier weekly history.

Some advanced metrics have shorter or sparser historical coverage than basic box-score statistics. Structurally optional values remain database nulls and render as `—`; the pipeline never replaces genuinely unavailable historical metrics with zero.

Download and rebuild the generated, ignored import files with:

```bash
python3 scripts/download_nflverse_player_stats.py
npm run data:build
python3 scripts/compare_historical_providers.py
```

Validate the import without credentials or network writes, then run the trusted batch upsert after applying the migrations:

```bash
python3 scripts/import_historical_data.py --dry-run --replace-source
python3 scripts/import_historical_data.py --replace-source
python3 scripts/import_historical_data.py --verify-only
```

The importer requires the processed data to begin in 2012 and validates its contiguous season range, identity coverage, logical uniqueness, scoring semantics, and identifier formatting before any remote write. Normal imports are idempotent upserts. `--replace-source` is an explicit destructive mode scoped only to `provider = nflverse` rows within that validated local range; it never deletes players, Sleeper mappings, leagues, rosters, or auth data.

## Player stats explorer

Authenticated users can open `/players` for database-backed historical leaderboards and `/players/[playerId]` for season summaries and weekly game logs. Filters use shareable query parameters and include:

- Every successfully imported season, currently 2012–2025, plus a separate 2026 projected/actual mode
- Synced Sleeper league scoring by default when a league is selected, plus Standard, Half PPR, and PPR fallbacks
- QB, RB, WR, TE, and FLEX; FLEX means RB + WR + TE and excludes QB
- Regular season by default, with postseason kept separate
- Top-50 pagination and sorting by fantasy points, PPG, yards, touchdowns, and usage

Player search queries the local PostgreSQL player table, ranks exact and prefix matches first, and never calls Sleeper while typing. Historical leaderboards use `historical_position`; current identity displays retain `sleeper_position` independently.

Position-aware grids expose the relevant fantasy, passing, rushing, receiving, usage, and advanced fields for each position. Season efficiency is calculated from season totals: completions/attempts, passing yards/attempts, rushing yards/attempts, receiving yards/targets, and receiving yards/receptions. `true_touches` means rushing attempts plus receptions. QB total offense is passing plus rushing; RB/WR/TE total offense is rushing plus receiving. Regular season and postseason are always separate rows.

League views expose every synchronized fantasy team. Sleeper's ordered starter array is mapped to the league's actual roster-position configuration during synchronization, preserving repeated slots and FLEX/SUPERFLEX assignments. Starters render before a deterministic position/name-sorted bench.

## Player projection pipeline

The V2 projection system is a separate, reproducible layer on top of the normalized nflverse history:

```text
official nflverse schedules + 2012–2025 REG player weeks
        ↓ prior-season, home/away/rest, shifted player/opponent features
chronological XGBoost models by position
        ↓ projected football stat line + direct PPR evaluation target
versioned player projection
        ↓ selected Sleeper scoring settings
league-specific projected points, floor, median, ceiling, and drivers
```

Each modeling row describes what was known before that game. Player season averages and rolling 3/5/8-game features are shifted by one game. Prior-season games, PPG, usage, and position percentile come only from season N-1. The official nflverse schedule supplies opponent, home/away, neutral site, days of rest, short/long week, Thursday, and bye-return context. Opponent production allowed is aggregated by position with shifted three/four-game and season windows, so the game being predicted never contributes to its defensive features.

Validation is chronological: 2012–2022 trains the model, 2023 determines the 20th/80th-percentile residual bands, and 2024–2025 is the untouched test set. The saved manifest reports MAE, RMSE, and correlation against season PPG, last-three, and last-five baselines, both overall and by position. Generated model files and large feature/projection CSVs are reproducible artifacts and are intentionally gitignored.

Install the Python model dependency and build/train/evaluate with:

```bash
python3 -m pip install -r requirements-projections.txt
npm run data:schedules
npm run projection:features
npm run projection:train
npm run projection:evaluate
```

On macOS, XGBoost also requires the OpenMP runtime: `brew install libomp`.

Generate a target week, validate it, then import it after applying the latest migration:

```bash
python3 scripts/generate_weekly_projections.py --season 2026 --week 1 --version v2 --require-schedule
python3 scripts/import_player_projections.py --version v2 --dry-run
npx supabase db push
python3 scripts/import_player_projections.py --version v2
```

`npm run data:schedules` downloads the maintained [nflverse schedules release](https://github.com/nflverse/nflverse-data/releases/tag/schedules) and writes the ignored, normalized `data/processed/schedules.csv`. Generation auto-loads that file. `--schedule` remains available for a player-level override containing `player_id` and `opponent_team`; `--require-schedule` fails clearly instead of silently omitting matchup context. Imports use `NEXT_PUBLIC_SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY`.

The database stores projected football stats, not only a universal PPR number. Standard, Half PPR, PPR, and supported custom Sleeper rates are applied at read time through the same centralized league-scoring rules used elsewhere in the app. Unsupported Sleeper bonuses remain a documented scoring limitation rather than being approximated. Floor and ceiling use 20th/80th-percentile 2023 residuals conditioned on projected scoring range. Independently modeled stat components are scaled together to the direct PPR target, retaining their ratios for custom scoring without creating a contradictory fantasy total.

The V2 arbitration layer retains `model_projection_ppr`, gates its component
volume using current team/depth opportunity, independently converts supported
consensus player props using league scoring, and writes a reconciled
`final_projection_ppr`. Fresh, multi-book player props receive roughly 40–65%
market weight; game-only context receives 5–20%; unavailable or stale evidence
receives zero. Player Value and Trade Finder consume the reconciled component
line, so Vegas is never added a second time. Audit locally with
`npm run projections:audit`; remote reconciliation is dry-run by default.

### Schedule, matchup, and odds pipeline

The official nflverse schedule is the canonical game source. It is normalized locally, then imported as one database row per game. `/matchups` joins that schedule to optional consensus odds and links each team to its current depth chart; `/depth-charts` exposes the same canonical player identities directly. Missing odds or depth data renders as `—` and never blocks the schedule, roster, projection, or trade experience.

```bash
npm run data:schedules
npm run data:schedules:import:dry-run
npm run data:schedules:import
```

The Odds API v4 integration is server-only and sportsbook-neutral. Featured sync requests only NFL `h2h`, `spreads`, and `totals` for the US region using American odds. Each sportsbook snapshot is retained, while `odds_games_consensus` derives the median spread, total, moneylines, and implied team totals from the latest snapshot per book. Missing markets remain null. The API quota response headers are logged after every request.

```bash
# Requires ODDS_API_KEY and the server-only Supabase service-role key.
# Dry-run prevents database writes but still consumes Odds API quota.
npm run data:odds:sync -- --season 2026 --week 1 --dry-run
npm run data:odds:sync -- --season 2026 --week 1

# Player props are deliberately opt-in and event-scoped because they consume
# additional quota. Omit --event-ids to use every mapped event for that week.
npm run data:odds:sync -- --season 2026 --week 1 --props --event-ids EVENT_ID
```

Supported opt-in prop markets are passing/rushing/receiving yards, passing touchdowns, receptions, pass attempts/completions/interceptions, and anytime touchdowns. Player names are normalized conservatively; ambiguous or unmatched names are skipped rather than guessed. The app does not scrape sportsbooks, embed an API key in browser code, or fabricate historical odds. Blend weights and outlier diagnostics are centralized in the projection arbitration service and remain configurable for later chronological backtesting.

## Player Value and team strength

Player Value is a deterministic, interpretable near-0-to-50 layer over the existing football-stat projections. Fifty is a soft historical-level reference, not a cap; the transform permits a rare, controlled tail toward 55. It never trains or stores a second projection. The general value uses a documented 10-team, 1QB/2RB/2WR/1TE/2FLEX/6-bench Half-PPR league; a synced league is rescored from the same projected stat line using its supported Sleeper rules and actual roster positions.

Replacement demand is calculated from the projected pool. Every league-wide fixed starter slot is filled first. Constrained FLEX slots and then broader FLEX/SUPER_FLEX slots are assigned to the highest projected remaining eligible player. Bench slots extend the roster boundary proportionally to each position's starter demand, so 1QB benches do not fill with quarterbacks merely because QB raw scoring is higher. Replacement PPG is the first player outside that position's complete roster boundary. This makes team count, bench depth, multiple FLEX slots, and Superflex change replacement levels without static position multipliers.

The raw formula is:

```text
VORP/game       = projected median PPG - replacement PPG
ROS VORP        = VORP/game × expected games remaining
floor VORP      = max(0, floor PPG - replacement PPG) × games
upside          = max(0, ceiling PPG - median PPG) × games
scarcity bonus  = (elite PPG - replacement PPG) × games × elite share

production raw = confidence factor × (
  ROS VORP
  + 0.10 × floor VORP
  + 0.20 × upside
  + 0.15 × scarcity bonus
)

opportunity confidence = established-production share
  + speculative share × (draft-capital confidence × depth opportunity)

opportunity-adjusted raw = production raw × opportunity confidence
  - unproven opportunity cost

raw value = opportunity-adjusted raw
  + games × (gated age context + draft context + depth-role context)
```

Elite and starter PPG are derived from the current position curve. Confidence uses the projection model's existing High/Medium/Low classification with deliberately small factors of 1.00/0.98/0.96. Expected games are currently the remaining portion of a 17-game season (`18 - projection week`), isolated for replacement when schedule/bye availability is added.

At the start of a season, proven players use a configurable recent-history prior: 60% of the prior season, 30% of two seasons ago, and 10% of three seasons ago. A veteran with at least four historical games receives 20% prior signal before Week 1; that influence decays linearly with current-season games and reaches zero after eight games. The 20% starting weight was selected from the chronological 2024–2025 Weeks 1–4 backtest; larger 40–55% blends were less accurate. Rookies and players without enough history stay projection-only. The same blend is rescored using the selected league's supported Sleeper settings.

Displayed value uses a monotonic softplus transformation around a generic historical raw reference. Signed raw scores are preserved, so a player just below replacement decays smoothly to a small positive value instead of falling off a zero cliff. The reference profile maps near 49; values above 50 enter a soft exponential tail that approaches 55 without a hard clamp. No player name or season is part of production math. Historical profiles such as 2019 Christian McCaffrey remain reporting-only calibration checks.

Age/upside context is position-specific and deliberately small: RB decline arrives sooner than WR/TE decline, while quarterbacks retain a longer curve. It changes Player Value only, never projected PPG. Youth is opportunity-gated rather than rewarded alone. Draft year/round/pick come from the official nflverse players release and join by GSIS ID. `draft_status` distinguishes drafted, confirmed UDFA, and unknown players; a null status means enrichment has not run and remains neutral. Current depth roles are sourced from nflverse's dated ESPN depth charts. For low-history players, draft investment and current depth access control how much confidence the value layer places in projection upside. Established production progressively protects veterans from transient depth labels. Missing depth/draft enrichment is neutral, and backup-QB opportunity is less punitive in Superflex.

Depth charts and historical priors are optional enrichment. Their Supabase lookups use a four-second timeout, one transient retry, structured server warnings, and neutral fallbacks. A network failure therefore removes only the depth/prior contribution; synchronized roster ownership, manual Trade Finder selection, projections, and the remaining Player Value inputs continue independently. Required league and roster ownership failures remain explicit errors.

League Overview batches the current projection pool, all league rosters, and all roster players. Rows show league-scored projected PPG, league-adjusted value, and position rank, and link to the existing `/players/[playerId]` detail route. Team projected PPG uses an exact bitmask lineup optimizer: each roster player can fill at most one eligible starter slot, and the combination with the highest projected PPG wins. Bench players count only when selected into that optimal lineup. Missing projections render as unavailable and produce a clearly marked partial lineup total.

Player values are not duplicated into roster records. League pages hydrate roster ownership once, then batch only those canonical player IDs for the focused Player Value history view and depth roles. Depth snapshots use migration `20260816080000_player_depth_charts.sql`; draft fields and the focused history view use the new `20260817132025` and `20260817133546` migrations. Refresh, validate, apply the migrations, and import with:

```bash
npm run data:depth-charts
npm run data:depth-charts:import:dry-run
npm run data:players
npm run data:players:import:dry-run
npx supabase db push
python3 scripts/import_depth_charts.py
python3 scripts/import_player_draft_capital.py
```

The `/trades` route reuses synchronized roster ownership and league-scored values. Manual mode uses locally filtered, selectable roster rows and performs analysis only when requested. Automatic mode considers bounded 1-for-1, 2-for-1, 1-for-2, 2-for-2, 2-for-3, and 3-for-2 packages among each team's top 12 meaningful assets. It range-prunes by summed value before running the exact lineup optimizer for both teams, then evaluates starter PPG change, bench-depth change, asset value, positional need, and a bounded consolidation benefit. Roster holes are penalized, equivalent packages are removed, only six preliminary candidates per opponent receive expensive simulation, and results are diversified to at most two suggestions per opponent (20 total). Depth charts and matchup enrichment remain optional. It is an explainable decision aid, not an acceptance-probability model. Run `npm run trade:benchmark` for the reproducible representative-league timing comparison.

Run the reproducible historical/current calibration report with:

```bash
npm run value:calibrate
```

This writes the ignored `data/processed/player_value_calibration_report.json`, including min/median/p75/p90/p95/max, exact-zero count, and upper-tail counts. A candidate model can be generated to a separate output and passed to `scripts/calibrate_player_values.py --projections ...` before any import. Schedule, feature, model, projection, and calibration artifacts remain reproducible and ignored.

### Historical provider transition

The original Kaggle statistical source was retired after validation found incorrect player-season totals, including Derrick Henry's 2024 rushing production. nflverse correctly produces 325 carries, 1,921 rushing yards, 16 rushing touchdowns, 19 receptions, 193 receiving yards, and two receiving touchdowns for that case. The old files are retained only for the reproducible provider-comparison diagnostic and are not an active fallback.

Migration `20260816040000_nflverse_player_stats.sql` adds provider-neutral nflverse fields and makes the explorer views read only `provider = 'nflverse'`. Apply migrations, rebuild, validate, and explicitly replace the old weekly source with:

```bash
npx supabase db push
python3 scripts/download_nflverse_player_stats.py
npm run data:build
python3 scripts/import_historical_data.py --dry-run --replace-source
python3 scripts/import_historical_data.py --replace-source
```

Manual mapping corrections are stored in [`data/player_mapping_overrides.csv`](data/player_mapping_overrides.csv). Its `action` is either `match` (with a Sleeper ID) or `unmatched`; generated mapping CSVs should never be manually edited.

## Future roadmap

- NFL weekly statistics ingestion
- Custom player value metric
- Deeper trade analysis, draft-pick support, and acceptance modeling
- Waiver wire and start/sit recommendations
- Positional scarcity and player trend analysis
- League-specific player values
