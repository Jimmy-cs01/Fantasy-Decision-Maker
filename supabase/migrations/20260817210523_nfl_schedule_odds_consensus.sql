create table if not exists public.nfl_games (
  id uuid primary key default gen_random_uuid(),
  nflverse_game_id text not null unique,
  season integer not null check (season >= 1999),
  week integer not null check (week between 1 and 25),
  season_type text not null check (season_type in ('REG', 'POST')),
  kickoff timestamptz,
  home_team text not null,
  away_team text not null,
  neutral_site boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season, week, season_type, home_team, away_team),
  check (home_team <> away_team)
);

create index if not exists nfl_games_week_idx
  on public.nfl_games (season, week, season_type, kickoff);
create index if not exists nfl_games_teams_idx
  on public.nfl_games (home_team, away_team, kickoff);

drop trigger if exists nfl_games_updated_at on public.nfl_games;
create trigger nfl_games_updated_at before update on public.nfl_games
  for each row execute function public.set_updated_at();

alter table public.nfl_games enable row level security;
create policy "Authenticated users can read NFL games"
  on public.nfl_games for select to authenticated using (true);
grant select on public.nfl_games to authenticated;

alter table public.odds_games
  add column if not exists commence_time timestamptz,
  add column if not exists nfl_game_id uuid references public.nfl_games(id) on delete set null;

create index if not exists odds_games_nfl_game_latest_idx
  on public.odds_games (nfl_game_id, provider, captured_at desc);
create index if not exists odds_games_external_latest_idx
  on public.odds_games (provider, external_game_id, sportsbook, captured_at desc);

create or replace view public.odds_games_consensus
with (security_invoker = true)
as
with latest_book_snapshots as (
  select distinct on (provider, external_game_id, sportsbook)
    id,
    nfl_game_id,
    external_game_id,
    season,
    week,
    commence_time,
    home_team,
    away_team,
    provider,
    sportsbook,
    home_spread,
    game_total,
    home_moneyline,
    away_moneyline,
    home_implied_total,
    away_implied_total,
    captured_at
  from public.odds_games
  order by provider, external_game_id, sportsbook, captured_at desc
)
select
  nfl_game_id,
  external_game_id,
  season,
  week,
  max(commence_time) as commence_time,
  home_team,
  away_team,
  provider,
  percentile_cont(0.5) within group (order by home_spread)
    filter (where home_spread is not null) as consensus_home_spread,
  percentile_cont(0.5) within group (order by game_total)
    filter (where game_total is not null) as consensus_total,
  percentile_cont(0.5) within group (order by home_moneyline)
    filter (where home_moneyline is not null) as consensus_home_moneyline,
  percentile_cont(0.5) within group (order by away_moneyline)
    filter (where away_moneyline is not null) as consensus_away_moneyline,
  percentile_cont(0.5) within group (order by home_implied_total)
    filter (where home_implied_total is not null) as consensus_home_implied_total,
  percentile_cont(0.5) within group (order by away_implied_total)
    filter (where away_implied_total is not null) as consensus_away_implied_total,
  count(*)::integer as books_reporting,
  max(captured_at) as latest_update
from latest_book_snapshots
group by nfl_game_id, external_game_id, season, week, home_team, away_team, provider;

grant select on public.odds_games_consensus to authenticated;

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
  max(captured_at) as latest_update
from latest_book_props
group by player_id, nfl_game_id, external_game_id, provider, market;

grant select on public.player_props_consensus to authenticated;

comment on table public.nfl_games is
  'Canonical nflverse schedule games enriched by optional provider event identifiers and odds.';
comment on view public.odds_games_consensus is
  'Median consensus from each sportsbook latest snapshot for a provider event.';
