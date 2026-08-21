-- Server-only, timestamped evidence archive for future leakage-safe consensus
-- calibration. No anonymous or authenticated Data API access is granted.
create table if not exists public.projection_consensus_snapshots (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  model_version_id uuid not null references public.model_versions(id) on delete restrict,
  nfl_game_id uuid references public.nfl_games(id) on delete set null,
  season integer not null,
  week integer not null check (week between 1 and 25),
  season_type text not null default 'REG' check (season_type in ('REG', 'POST')),
  source text not null check (source in ('sleeper', 'vegas', 'jimmy_raw', 'jimmy_final')),
  source_projection_ppr numeric,
  components jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  retrieved_at timestamptz not null,
  kickoff timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (player_id, model_version_id, season, week, season_type, source, retrieved_at)
);

create index if not exists projection_consensus_snapshots_lookup_idx
  on public.projection_consensus_snapshots
  (season desc, week desc, source, player_id, retrieved_at desc);

alter table public.projection_consensus_snapshots enable row level security;
revoke all on public.projection_consensus_snapshots from anon, authenticated;

comment on table public.projection_consensus_snapshots is
  'Server-only pre-kickoff projection evidence archive used for future leakage-safe consensus calibration.';
