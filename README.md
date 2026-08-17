# Jim's Fantasy Helper

A personal fantasy football analytics foundation built around Sleeper leagues. It imports a private copy of a user's league data, displays a roster-first dashboard, and leaves clear seams for weekly NFL data and future decision-support features.

## Tech stack

- Next.js App Router, React, TypeScript, Tailwind CSS
- Supabase Auth and PostgreSQL
- Sleeper's public API, accessed only from server code
- ESLint, Prettier, and Vitest

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Create a Supabase project, copy its URL and anon key into `.env.local`, then run the SQL migration below.

## Environment variables

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY= # server/admin importer only; never expose to browser code
```

The app uses the public URL and anon key. The historical importer additionally needs the service-role key. Never place a service-role key in a `NEXT_PUBLIC_` variable or print/commit it.

## Database and Supabase setup

1. Create a Supabase project and enable Email/Password sign-in in Authentication.
2. In the Supabase SQL editor, apply the files in [`supabase/migrations`](supabase/migrations) in timestamp order.
3. Add the project URL and anon key to `.env.local`.

The migration provides UUID internal IDs, separate Sleeper external IDs, constraints, indexes, timestamps, and Row Level Security. User-owned leagues, members, teams, rosters, and sync records can only be queried by their owner at the database layer.

## Sleeper integration

The `/dashboard/connect` flow validates a Sleeper username on the server, displays its current-season NFL leagues, and imports the selected league. Syncing fetches the league, members, rosters, and player directory, then upserts normalized records. Repeated synchronization updates the imported league rather than duplicating it.

Matchups and transactions are available through the client but intentionally are not imported yet—there is no dashboard use for them in this first version.

## Project structure

```text
app/                 Routes, server actions, and dashboard UI
components/          Reusable dashboard and UI components
lib/db/              Persistence and synchronization orchestration
lib/sleeper/         Sleeper HTTP client, API types, normalization
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

- Every successfully imported season, currently 2012–2025
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

### Vegas-ready architecture

`OddsProvider` is provider- and sportsbook-neutral, and the new `odds_games` / `player_props` tables can retain timestamped market snapshots. The no-op provider keeps local development free. No sportsbook is scraped and no paid API is required. When historical odds become available, statistical/market blend weights should be learned by chronological backtesting rather than hardcoded.

The 2026 schedule/opponents are now automatic. Current roster/player availability, injuries, depth charts, newly completed 2026 nflverse weeks, odds, and player props remain future inputs.

## Player Value and team strength

Player Value is a deterministic 0–100 layer over the existing football-stat projections. It never trains or stores a second projection. The general value uses a documented 10-team, 1QB/2RB/2WR/1TE/2FLEX Half-PPR league; a synced league is rescored from the same projected stat line using its supported Sleeper rules and actual roster positions.

Replacement demand is calculated from the projected pool. Every league-wide fixed starter slot is filled first. Constrained FLEX slots and then broader FLEX/SUPER_FLEX slots are assigned to the highest projected remaining eligible player. Replacement PPG is the first projected player outside that position's resulting starter demand. This makes team count, multiple FLEX slots, and Superflex change replacement levels without static position multipliers. Bench depth is intentionally not part of V1 replacement demand.

The raw formula is:

```text
VORP/game       = projected median PPG - replacement PPG
ROS VORP        = VORP/game × expected games remaining
floor VORP      = max(0, floor PPG - replacement PPG) × games
upside          = max(0, ceiling PPG - median PPG) × games
scarcity bonus  = (elite PPG - replacement PPG) × games × elite share

raw value = confidence factor × (
  ROS VORP
  + 0.10 × floor VORP
  + 0.20 × upside
  + 0.15 × scarcity bonus
)
```

Elite and starter PPG are derived from the current position curve. Confidence uses the projection model's existing High/Medium/Low classification with deliberately small factors of 1.00/0.98/0.96. Expected games are currently the remaining portion of a 17-game season (`18 - projection week`), isolated for replacement when schedule/bye availability is added.

At the start of a season, proven players use a configurable recent-history prior: 60% of the prior season, 30% of two seasons ago, and 10% of three seasons ago. A veteran with at least four historical games receives 20% prior signal before Week 1; that influence decays linearly with current-season games and reaches zero after eight games. The 20% starting weight was selected from the chronological 2024–2025 Weeks 1–4 backtest; larger 40–55% blends were less accurate. Rookies and players without enough history stay projection-only. The same blend is rescored using the selected league's supported Sleeper settings.

The permanent scale fixture in [`lib/player-values/calibration.json`](lib/player-values/calibration.json) derives the benchmark from 2019 Christian McCaffrey's season and the 2019 default-league RB replacement curve. His raw benchmark is 315.228 and is exactly 100. Displayed value uses the monotonic historical calibration `100 × (raw / CMC raw)^0.40`, clamped to 0–99.9 for every non-anchor player. This expands meaningful starter/FLEX differences without changing rank order or letting a current player move the benchmark.

League Overview batches the current projection pool, all league rosters, and all roster players. Rows show league-scored projected PPG, league-adjusted value, and position rank, and link to the existing `/players/[playerId]` detail route. Team projected PPG uses an exact bitmask lineup optimizer: each roster player can fill at most one eligible starter slot, and the combination with the highest projected PPG wins. Bench players count only when selected into that optimal lineup. Missing projections render as unavailable and produce a clearly marked partial lineup total.

No Player Value cache or migration is needed for V1; 613 projections are cheap to rescore and rank, and avoiding persisted league copies prevents stale values. The future trade analyzer can consume general/league value, ranks, VORP, ROS VORP, distribution, and confidence through `getPlayerValue(playerId, leagueId?)` or `/api/player-values/[playerId]`.

Run the reproducible historical/current calibration report with:

```bash
npm run value:calibrate
```

This writes the ignored `data/processed/player_value_calibration_report.json`. A candidate model can be generated to a separate output and passed to `scripts/calibrate_player_values.py --projections ...` before any import. No projection or Player Value migration is required for V2; schedule, feature, model, projection, and calibration artifacts remain reproducible and ignored.

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
- Trade analyzer and trade finder
- Waiver wire and start/sit recommendations
- Positional scarcity and player trend analysis
- League-specific player values
