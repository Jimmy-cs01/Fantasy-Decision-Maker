create extension if not exists "pgcrypto";

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = timezone('utc', now()); return new; end; $$;

create table public.sleeper_accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  sleeper_user_id text not null, username text not null, display_name text, avatar_id text,
  created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, sleeper_user_id)
);
create table public.leagues (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  sleeper_league_id text not null, season integer not null, name text not null, status text, sport text not null default 'nfl',
  season_type text, total_rosters integer, scoring_settings jsonb not null default '{}'::jsonb, roster_positions jsonb not null default '[]'::jsonb,
  last_synced_at timestamptz, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()),
  unique (owner_id, sleeper_league_id)
);
create table public.league_members (
  id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id) on delete cascade,
  sleeper_user_id text not null, username text, display_name text, avatar_id text,
  created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), unique (league_id, sleeper_user_id)
);
create table public.fantasy_teams (
  id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id) on delete cascade,
  league_member_id uuid references public.league_members(id) on delete set null, sleeper_roster_id integer not null, name text, wins integer, losses integer, ties integer,
  created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), unique (league_id, sleeper_roster_id)
);
create table public.rosters (
  id uuid primary key default gen_random_uuid(), fantasy_team_id uuid not null unique references public.fantasy_teams(id) on delete cascade,
  starters jsonb not null default '[]'::jsonb, reserve jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now())
);
create table public.players (
  id uuid primary key default gen_random_uuid(), sleeper_player_id text unique, full_name text not null, first_name text, last_name text, position text, team text, status text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now())
);
create table public.roster_players (
  roster_id uuid not null references public.rosters(id) on delete cascade, player_id uuid not null references public.players(id) on delete cascade,
  is_starter boolean not null default false, roster_slot text, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), primary key (roster_id, player_id)
);
create table public.player_weekly_nfl_statistics (
  id uuid primary key default gen_random_uuid(), player_id uuid not null references public.players(id) on delete cascade, season integer not null, week integer not null, provider text not null, stats jsonb not null, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), unique(player_id, season, week, provider)
);
create table public.player_fantasy_statistics (
  id uuid primary key default gen_random_uuid(), player_id uuid not null references public.players(id) on delete cascade, league_id uuid not null references public.leagues(id) on delete cascade, season integer not null, week integer not null, fantasy_points numeric(8,2) not null, scoring_snapshot jsonb not null default '{}'::jsonb, created_at timestamptz not null default timezone('utc', now()), updated_at timestamptz not null default timezone('utc', now()), unique(player_id, league_id, season, week)
);
create table public.synchronization_records (
  id uuid primary key default gen_random_uuid(), league_id uuid not null references public.leagues(id) on delete cascade, initiated_by uuid references auth.users(id) on delete set null, status text not null check(status in ('started','completed','failed')), source text not null default 'sleeper', details jsonb not null default '{}'::jsonb, started_at timestamptz not null default timezone('utc', now()), completed_at timestamptz, created_at timestamptz not null default timezone('utc', now())
);
create index leagues_owner_id_idx on public.leagues(owner_id); create index league_members_league_id_idx on public.league_members(league_id); create index fantasy_teams_league_id_idx on public.fantasy_teams(league_id); create index roster_players_player_id_idx on public.roster_players(player_id); create index weekly_stats_lookup_idx on public.player_weekly_nfl_statistics(player_id, season, week); create index sync_records_league_id_idx on public.synchronization_records(league_id, created_at desc);
do $$ declare t text; begin foreach t in array array['sleeper_accounts','leagues','league_members','fantasy_teams','rosters','players','roster_players','player_weekly_nfl_statistics','player_fantasy_statistics'] loop execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t); end loop; end $$;

alter table public.sleeper_accounts enable row level security; alter table public.leagues enable row level security; alter table public.league_members enable row level security; alter table public.fantasy_teams enable row level security; alter table public.rosters enable row level security; alter table public.roster_players enable row level security; alter table public.player_fantasy_statistics enable row level security; alter table public.synchronization_records enable row level security;
create policy "own sleeper accounts" on public.sleeper_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own leagues" on public.leagues for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "league members for owners" on public.league_members for all using (exists(select 1 from public.leagues l where l.id = league_id and l.owner_id = auth.uid())) with check (exists(select 1 from public.leagues l where l.id = league_id and l.owner_id = auth.uid()));
create policy "teams for owners" on public.fantasy_teams for all using (exists(select 1 from public.leagues l where l.id = league_id and l.owner_id = auth.uid())) with check (exists(select 1 from public.leagues l where l.id = league_id and l.owner_id = auth.uid()));
create policy "rosters for owners" on public.rosters for all using (exists(select 1 from public.fantasy_teams t join public.leagues l on l.id=t.league_id where t.id=fantasy_team_id and l.owner_id=auth.uid())) with check (exists(select 1 from public.fantasy_teams t join public.leagues l on l.id=t.league_id where t.id=fantasy_team_id and l.owner_id=auth.uid()));
create policy "roster players for owners" on public.roster_players for all using (exists(select 1 from public.rosters r join public.fantasy_teams t on t.id=r.fantasy_team_id join public.leagues l on l.id=t.league_id where r.id=roster_id and l.owner_id=auth.uid())) with check (exists(select 1 from public.rosters r join public.fantasy_teams t on t.id=r.fantasy_team_id join public.leagues l on l.id=t.league_id where r.id=roster_id and l.owner_id=auth.uid()));
create policy "fantasy stats for owners" on public.player_fantasy_statistics for all using (exists(select 1 from public.leagues l where l.id=league_id and l.owner_id=auth.uid())) with check (exists(select 1 from public.leagues l where l.id=league_id and l.owner_id=auth.uid()));
create policy "sync records for owners" on public.synchronization_records for all using (exists(select 1 from public.leagues l where l.id=league_id and l.owner_id=auth.uid())) with check (exists(select 1 from public.leagues l where l.id=league_id and l.owner_id=auth.uid()));
alter table public.players enable row level security; alter table public.player_weekly_nfl_statistics enable row level security;
create policy "authenticated users read players" on public.players for select to authenticated using (true); create policy "authenticated users write players" on public.players for insert to authenticated with check (true); create policy "authenticated users update players" on public.players for update to authenticated using (true) with check (true); create policy "authenticated users read nfl stats" on public.player_weekly_nfl_statistics for select to authenticated using (true);
