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
SUPABASE_SERVICE_ROLE_KEY= # optional now; reserved for future trusted background jobs
```

Only the public URL and anon key are required for the initial app. Never place a service-role key in a `NEXT_PUBLIC_` variable.

## Database and Supabase setup

1. Create a Supabase project and enable Email/Password sign-in in Authentication.
2. In the Supabase SQL editor, run [`supabase/migrations/20260816000000_initial_schema.sql`](supabase/migrations/20260816000000_initial_schema.sql).
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

The raw weekly data, rather than Kaggle's precomputed rolling metrics, is retained for future internal feature engineering. Rebuild the generated, ignored import files with:

```bash
python3 scripts/match_sleeper_players.py
python3 scripts/build_historical_weekly_stats.py
```

Manual mapping corrections are stored in [`data/player_mapping_overrides.csv`](data/player_mapping_overrides.csv). Its `action` is either `match` (with a Sleeper ID) or `unmatched`; generated mapping CSVs should never be manually edited.

## Future roadmap

- NFL weekly statistics ingestion
- Custom player value metric
- Trade analyzer and trade finder
- Waiver wire and start/sit recommendations
- Positional scarcity and player trend analysis
- League-specific player values
