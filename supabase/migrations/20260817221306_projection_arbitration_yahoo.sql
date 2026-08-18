alter table public.player_projections
  add column if not exists raw_projected_stats jsonb,
  add column if not exists opportunity_adjusted_ppr numeric,
  add column if not exists sleeper_projection_ppr numeric,
  add column if not exists vegas_confidence numeric check (vegas_confidence between 0 and 1),
  add column if not exists opportunity_confidence numeric check (opportunity_confidence between 0 and 1),
  add column if not exists sanity_adjustment numeric,
  add column if not exists outlier_classification text
    check (outlier_classification in ('normal', 'watch', 'large', 'extreme')),
  add column if not exists projection_diagnostics jsonb not null default '{}'::jsonb;

comment on column public.player_projections.blend_weight_model is
  'Weight assigned to the opportunity-adjusted statistical model. Vegas weight is 1 - blend_weight_model.';
comment on column public.player_projections.raw_projected_stats is
  'Original component model output retained before opportunity and external-evidence arbitration.';

create table public.yahoo_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_user_id text not null,
  display_name text,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider_user_id)
);

alter table public.yahoo_accounts enable row level security;
-- OAuth credentials are intentionally service-role-only. No anon/authenticated grants.
revoke all on public.yahoo_accounts from anon, authenticated;

drop trigger if exists yahoo_accounts_updated_at on public.yahoo_accounts;
create trigger yahoo_accounts_updated_at before update on public.yahoo_accounts
  for each row execute function public.set_updated_at();

alter table public.leagues
  add column if not exists provider text not null default 'sleeper',
  add column if not exists external_league_id text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
update public.leagues
set external_league_id = sleeper_league_id
where external_league_id is null and sleeper_league_id is not null;
alter table public.leagues alter column sleeper_league_id drop not null;
create unique index if not exists leagues_owner_provider_external_idx
  on public.leagues (owner_id, provider, external_league_id);

alter table public.league_members
  add column if not exists provider_member_id text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
update public.league_members
set provider_member_id = sleeper_user_id
where provider_member_id is null and sleeper_user_id is not null;
alter table public.league_members alter column sleeper_user_id drop not null;
create unique index if not exists league_members_provider_identity_idx
  on public.league_members (league_id, provider_member_id);

alter table public.fantasy_teams
  add column if not exists provider_team_id text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
update public.fantasy_teams
set provider_team_id = sleeper_roster_id::text
where provider_team_id is null and sleeper_roster_id is not null;
alter table public.fantasy_teams alter column sleeper_roster_id drop not null;
create unique index if not exists fantasy_teams_provider_identity_idx
  on public.fantasy_teams (league_id, provider_team_id);

create table public.player_provider_ids (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  provider text not null,
  external_player_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, external_player_id),
  unique (player_id, provider)
);
create index if not exists player_provider_ids_player_idx
  on public.player_provider_ids (player_id, provider);
alter table public.player_provider_ids enable row level security;
revoke all on public.player_provider_ids from anon, authenticated;
create policy "Authenticated users read player provider identities"
  on public.player_provider_ids for select to authenticated using (true);
grant select on public.player_provider_ids to authenticated;
drop trigger if exists player_provider_ids_updated_at on public.player_provider_ids;
create trigger player_provider_ids_updated_at before update on public.player_provider_ids
  for each row execute function public.set_updated_at();

create or replace view public.player_props_consensus
with (security_invoker = true)
as
with latest_book_props as (
  select distinct on (prop.player_id, game.external_game_id, prop.provider, prop.sportsbook, prop.market)
    prop.player_id,
    game.nfl_game_id,
    game.external_game_id,
    prop.provider,
    prop.sportsbook,
    prop.market,
    prop.line,
    prop.over_odds,
    prop.under_odds,
    prop.captured_at
  from public.player_props as prop
  join public.odds_games as game on game.id = prop.odds_game_id
  order by prop.player_id, game.external_game_id, prop.provider, prop.sportsbook, prop.market, prop.captured_at desc
)
select
  player_id,
  nfl_game_id,
  external_game_id,
  provider,
  market,
  percentile_cont(0.5) within group (order by line) as consensus_line,
  percentile_cont(0.5) within group (order by over_odds)
    filter (where over_odds is not null) as consensus_over_odds,
  percentile_cont(0.5) within group (order by under_odds)
    filter (where under_odds is not null) as consensus_under_odds,
  count(*)::integer as books_reporting,
  max(captured_at) as latest_update,
  stddev_pop(line) as line_stddev
from latest_book_props
group by player_id, nfl_game_id, external_game_id, provider, market;

grant select on public.player_props_consensus to authenticated;
