create table if not exists public.player_depth_chart_roles (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  provider text not null,
  season integer not null check (season >= 1999),
  team text not null,
  position text not null,
  depth_position text not null,
  depth_rank integer not null check (depth_rank > 0),
  is_starter boolean not null default false,
  source_updated_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (player_id, provider, source_updated_at)
);

create index if not exists player_depth_chart_roles_player_latest_idx
  on public.player_depth_chart_roles (player_id, source_updated_at desc);
create index if not exists player_depth_chart_roles_team_role_idx
  on public.player_depth_chart_roles (season, team, position, depth_rank);

alter table public.player_depth_chart_roles enable row level security;

create policy "Authenticated users can read depth chart roles"
  on public.player_depth_chart_roles for select
  to authenticated
  using (true);

comment on table public.player_depth_chart_roles is
  'Provider-dated NFL depth chart snapshots mapped to canonical players by GSIS ID.';
