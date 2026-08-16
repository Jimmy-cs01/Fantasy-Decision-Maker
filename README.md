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
Kaggle weekly NFL statistics
        ↓ trim / normalize
GSIS/Kaggle player identity
        ↓ optional Sleeper identity mapping
processed historical weekly stats
        ↓ PostgreSQL / Supabase
internal feature engineering → fantasy value model
```

GSIS/Kaggle `player_id` is the canonical historical external identity. Sleeper IDs are optional text provider mappings, never application primary keys. Historical and Sleeper positions are retained separately because a player can legitimately change positions between data providers. Team is not an identity criterion because the Kaggle team is historical and Sleeper’s team is current.

The raw weekly data, rather than Kaggle's precomputed rolling metrics, is retained for future internal feature engineering. The current dataset contains 76,287 weekly rows across the 2012–2025 seasons. Rebuild the generated, ignored import files with:

```bash
python3 scripts/match_sleeper_players.py
python3 scripts/build_historical_weekly_stats.py
```

Validate the import without credentials or network writes, then run the trusted batch upsert after applying the migrations:

```bash
python3 scripts/import_historical_data.py --dry-run
python3 scripts/import_historical_data.py
```

The importer validates identity coverage, season range, logical uniqueness, and identifier formatting before any remote write. It upserts players first, reads back the GSIS-to-internal-UUID mapping, then batch-upserts weekly rows. Normal runs never truncate or delete historical data.

## Player stats explorer

Authenticated users can open `/players` for database-backed historical leaderboards and `/players/[playerId]` for season summaries and weekly game logs. Filters use shareable query parameters and include:

- Every imported season from 2012–2025
- Standard, Half PPR, and PPR scoring
- QB, RB, WR, TE, and FLEX; FLEX means RB + WR + TE and excludes QB
- Regular season by default, with postseason kept separate
- Top-50 pagination and sorting by fantasy points, PPG, yards, touchdowns, and usage

Player search queries the local PostgreSQL player table, ranks exact and prefix matches first, and never calls Sleeper while typing. Historical leaderboards use `historical_position`; current identity displays retain `sleeper_position` independently.

Leaderboard categories separate Fantasy, Passing, Rushing, Receiving, and Advanced statistics. Season efficiency is calculated from season totals: completions/attempts, passing yards/attempts, rushing yards/attempts, receiving yards/targets, receiving yards/receptions, and offense snaps/team offense snaps. `true_touches` means rushing attempts plus receptions. QB total offense is passing plus rushing; RB/WR/TE total offense is rushing plus receiving. Regular season and postseason are always separate rows.

### Historical source limitation

The imported Kaggle provider contains a small number of demonstrably incorrect touchdown game rows. For example, Derrick Henry's 2024 Week 4 row reports five rushing touchdowns and six total touchdowns; that inflation exists in the source CSV and is reproduced exactly in the database. The normalized view fixes aggregation, weighting, component naming, and season isolation, but does not fabricate corrections where no authoritative replacement field exists. Provider anomalies therefore also affect the source-provided fantasy-point totals. A future source-quality phase should reconcile touchdown events against an authoritative play-by-play source.

Migration `20260816030000_player_stats_accuracy.sql` expands the normalized view and adds newly retained provider fields. After applying it, rebuild and re-run the idempotent importer once so rushing first downs and source rate fields are populated:

```bash
python3 scripts/build_historical_weekly_stats.py
python3 scripts/import_historical_data.py --dry-run
python3 scripts/import_historical_data.py
```

Manual mapping corrections are stored in [`data/player_mapping_overrides.csv`](data/player_mapping_overrides.csv). Its `action` is either `match` (with a Sleeper ID) or `unmatched`; generated mapping CSVs should never be manually edited.

## Future roadmap

- NFL weekly statistics ingestion
- Custom player value metric
- Trade analyzer and trade finder
- Waiver wire and start/sit recommendations
- Positional scarcity and player trend analysis
- League-specific player values
