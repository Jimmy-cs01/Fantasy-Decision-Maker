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

## Future roadmap

- NFL weekly statistics ingestion
- Custom player value metric
- Trade analyzer and trade finder
- Waiver wire and start/sit recommendations
- Positional scarcity and player trend analysis
- League-specific player values
