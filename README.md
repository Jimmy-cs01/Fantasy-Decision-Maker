# Fantasy Decision Maker

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

The ETL reads only the required columns from `data/nflverse/stats_player_week_2012.csv` through `stats_player_week_2025.csv`. It keeps raw counting stats and nflverse EPA/usage features while deriving safe weekly rates and Half PPR scoring internally. Rebuild the generated, ignored import files with:

```bash
python3 scripts/build_historical_weekly_stats.py
python3 scripts/compare_historical_providers.py
```

Validate the import without credentials or network writes, then run the trusted batch upsert after applying the migrations:

```bash
python3 scripts/import_historical_data.py --dry-run --replace-source
python3 scripts/import_historical_data.py --replace-source
python3 scripts/import_historical_data.py --verify-only
```

The importer validates all 14 seasons, identity coverage, logical uniqueness, scoring semantics, and identifier formatting before any remote write. Normal imports are idempotent upserts. `--replace-source` is an explicit destructive mode scoped only to `player_weekly_nfl_statistics` rows for 2012–2025; it never deletes players, Sleeper mappings, leagues, rosters, or auth data. This prevents stale Kaggle rows from surviving a provider-key change.

## Player stats explorer

Authenticated users can open `/players` for database-backed historical leaderboards and `/players/[playerId]` for season summaries and weekly game logs. Filters use shareable query parameters and include:

- Every imported season from 2012–2025
- Standard, Half PPR, and PPR scoring
- QB, RB, WR, TE, and FLEX; FLEX means RB + WR + TE and excludes QB
- Regular season by default, with postseason kept separate
- Top-50 pagination and sorting by fantasy points, PPG, yards, touchdowns, and usage

Player search queries the local PostgreSQL player table, ranks exact and prefix matches first, and never calls Sleeper while typing. Historical leaderboards use `historical_position`; current identity displays retain `sleeper_position` independently.

Leaderboard categories separate Fantasy, Passing, Rushing, Receiving, and Advanced statistics. Season efficiency is calculated from season totals: completions/attempts, passing yards/attempts, rushing yards/attempts, receiving yards/targets, and receiving yards/receptions. `true_touches` means rushing attempts plus receptions. QB total offense is passing plus rushing; RB/WR/TE total offense is rushing plus receiving. Regular season and postseason are always separate rows. nflverse does not include snaps, pressure events, or red-zone rushing usage in this weekly file, so those fields remain nullable and render as unavailable rather than fabricated zeroes.

### Historical provider transition

The original Kaggle statistical source was retired after validation found incorrect player-season totals, including Derrick Henry's 2024 rushing production. nflverse correctly produces 325 carries, 1,921 rushing yards, 16 rushing touchdowns, 19 receptions, 193 receiving yards, and two receiving touchdowns for that case. The old files are retained only for the reproducible provider-comparison diagnostic and are not an active fallback.

Migration `20260816040000_nflverse_player_stats.sql` adds provider-neutral nflverse fields and makes the explorer views read only `provider = 'nflverse'`. Apply migrations, rebuild, validate, and explicitly replace the old weekly source with:

```bash
npx supabase db push
python3 scripts/build_historical_weekly_stats.py
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
