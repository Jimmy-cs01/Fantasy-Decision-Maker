create table public.player_injuries (
  player_id uuid primary key references public.players(id) on delete cascade,
  team text,
  status text not null default 'healthy' check (status in (
    'healthy', 'questionable', 'doubtful', 'out', 'ir', 'pup',
    'suspended', 'inactive', 'nfi', 'unknown'
  )),
  raw_status text,
  roster_status text,
  practice_participation text,
  practice_description text,
  injury_body_part text,
  injury_notes text,
  expected_return_date date,
  expected_games_missed numeric check (expected_games_missed is null or expected_games_missed >= 0),
  expected_weeks_missed numeric check (expected_weeks_missed is null or expected_weeks_missed >= 0),
  return_timeline_min_weeks numeric check (return_timeline_min_weeks is null or return_timeline_min_weeks >= 0),
  return_timeline_max_weeks numeric check (
    return_timeline_max_weeks is null
    or return_timeline_max_weeks >= coalesce(return_timeline_min_weeks, 0)
  ),
  timeline_confidence text check (timeline_confidence is null or timeline_confidence in ('low', 'medium', 'high')),
  timeline_source text,
  timeline_type text not null default 'unknown' check (timeline_type in ('reported', 'estimated', 'unknown')),
  source text not null,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_injury_history (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  team text,
  status text not null,
  raw_status text,
  roster_status text,
  practice_participation text,
  injury_body_part text,
  expected_return_date date,
  expected_games_missed numeric,
  timeline_type text not null default 'unknown',
  source text not null,
  observed_at timestamptz not null,
  snapshot jsonb not null default '{}'::jsonb
);

create index player_injuries_status_idx on public.player_injuries (status, updated_at desc);
create index player_injuries_updated_idx on public.player_injuries (updated_at desc);
create index player_injury_history_player_observed_idx on public.player_injury_history (player_id, observed_at desc);

alter table public.player_injuries enable row level security;
alter table public.player_injury_history enable row level security;

revoke all on table public.player_injuries from anon, authenticated;
revoke all on table public.player_injury_history from anon, authenticated;
grant select on table public.player_injuries to anon, authenticated;
grant select, insert, update, delete on table public.player_injuries to service_role;
grant select, insert, update, delete on table public.player_injury_history to service_role;
grant usage, select on sequence public.player_injury_history_id_seq to service_role;

create policy "public football injury status"
on public.player_injuries for select
to anon, authenticated
using (true);

comment on table public.player_injuries is
  'Latest provider-backed NFL availability status. Public read, service-role write.';
comment on table public.player_injury_history is
  'Server-only change snapshots used to audit and later recalibrate availability.';
