-- Versioned, provider-neutral projection storage. Football stat projections are
-- persisted independently of league scoring so the same forecast can be scored
-- against Standard, PPR, or a synced Sleeper league at read time.
create table if not exists public.model_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  algorithm text not null,
  training_start_season integer not null,
  training_end_season integer not null,
  features jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (training_end_season >= training_start_season)
);

create table if not exists public.player_projections (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  model_version_id uuid not null references public.model_versions(id) on delete restrict,
  season integer not null,
  week integer not null,
  season_type text not null default 'REG' check (season_type in ('REG', 'POST')),
  team text,
  opponent_team text,
  projected_stats jsonb not null default '{}'::jsonb,
  model_projection_ppr numeric,
  vegas_projection_ppr numeric,
  final_projection_ppr numeric,
  blend_weight_model numeric check (blend_weight_model between 0 and 1),
  projected_points_standard numeric not null,
  projected_points_half_ppr numeric not null,
  projected_points_ppr numeric not null,
  floor_ppr numeric not null,
  median_ppr numeric not null,
  ceiling_ppr numeric not null,
  residual_low numeric not null,
  residual_high numeric not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  drivers jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (player_id, season, week, season_type, model_version_id),
  check (week between 1 and 25),
  check (floor_ppr <= median_ppr and median_ppr <= ceiling_ppr)
);

create index if not exists player_projections_week_idx
  on public.player_projections (season desc, week desc, season_type);
create index if not exists player_projections_player_idx
  on public.player_projections (player_id, season desc, week desc);

create table if not exists public.odds_games (
  id uuid primary key default gen_random_uuid(),
  external_game_id text not null,
  season integer not null,
  week integer not null,
  home_team text not null,
  away_team text not null,
  provider text not null,
  sportsbook text not null,
  home_spread numeric,
  game_total numeric,
  home_moneyline integer,
  away_moneyline integer,
  home_implied_total numeric,
  away_implied_total numeric,
  captured_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (provider, sportsbook, external_game_id, captured_at)
);

create index if not exists odds_games_week_idx
  on public.odds_games (season, week, provider, sportsbook);

create table if not exists public.player_props (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  odds_game_id uuid not null references public.odds_games(id) on delete cascade,
  provider text not null,
  sportsbook text not null,
  market text not null,
  line numeric not null,
  over_odds integer,
  under_odds integer,
  captured_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (player_id, odds_game_id, provider, sportsbook, market, captured_at)
);

create index if not exists player_props_lookup_idx
  on public.player_props (player_id, odds_game_id, market);

drop trigger if exists model_versions_updated_at on public.model_versions;
create trigger model_versions_updated_at before update on public.model_versions
  for each row execute function public.set_updated_at();
drop trigger if exists player_projections_updated_at on public.player_projections;
create trigger player_projections_updated_at before update on public.player_projections
  for each row execute function public.set_updated_at();

alter table public.model_versions enable row level security;
alter table public.player_projections enable row level security;
alter table public.odds_games enable row level security;
alter table public.player_props enable row level security;

create policy "authenticated users read model versions" on public.model_versions
  for select to authenticated using (true);
create policy "authenticated users read projections" on public.player_projections
  for select to authenticated using (true);
create policy "authenticated users read odds games" on public.odds_games
  for select to authenticated using (true);
create policy "authenticated users read player props" on public.player_props
  for select to authenticated using (true);

grant select on public.model_versions, public.player_projections, public.odds_games, public.player_props to authenticated;

