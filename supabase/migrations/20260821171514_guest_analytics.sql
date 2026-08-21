create table public.guest_visitors (
  anonymous_id uuid primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  session_count integer not null default 0 check (session_count >= 0),
  visit_count integer not null default 0 check (visit_count >= 0),
  last_path text
);

create table public.guest_sessions (
  id bigint generated always as identity primary key,
  anonymous_id uuid not null references public.guest_visitors(anonymous_id) on delete cascade,
  session_id uuid not null,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  visit_count integer not null default 1 check (visit_count > 0),
  last_path text,
  unique (anonymous_id, session_id)
);

create index guest_visitors_last_seen_idx on public.guest_visitors (last_seen desc);
create index guest_sessions_last_seen_idx on public.guest_sessions (last_seen desc);

alter table public.guest_visitors enable row level security;
alter table public.guest_sessions enable row level security;

revoke all on table public.guest_visitors from anon, authenticated;
revoke all on table public.guest_sessions from anon, authenticated;
grant select, insert, update, delete on table public.guest_visitors to service_role;
grant select, insert, update, delete on table public.guest_sessions to service_role;
grant usage, select on sequence public.guest_sessions_id_seq to service_role;

create or replace function public.record_guest_activity(
  browser_id uuid,
  browser_session_id uuid,
  visited_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_session integer;
  safe_path text := left(nullif(trim(visited_path), ''), 300);
begin
  insert into public.guest_visitors (anonymous_id, first_seen, last_seen, visit_count, last_path)
  values (browser_id, now(), now(), 1, safe_path)
  on conflict (anonymous_id) do update
    set last_seen = excluded.last_seen,
        visit_count = public.guest_visitors.visit_count + 1,
        last_path = excluded.last_path;

  insert into public.guest_sessions (anonymous_id, session_id, started_at, last_seen, visit_count, last_path)
  values (browser_id, browser_session_id, now(), now(), 1, safe_path)
  on conflict (anonymous_id, session_id) do nothing
  returning 1 into inserted_session;

  if inserted_session = 1 then
    update public.guest_visitors
    set session_count = session_count + 1
    where anonymous_id = browser_id;
  else
    update public.guest_sessions
    set last_seen = now(),
        visit_count = visit_count + 1,
        last_path = safe_path
    where anonymous_id = browser_id and session_id = browser_session_id;
  end if;
end;
$$;

revoke all on function public.record_guest_activity(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_guest_activity(uuid, uuid, text) to service_role;

comment on table public.guest_visitors is 'Privacy-conscious anonymous browser counters; server-service access only.';
comment on table public.guest_sessions is 'Ephemeral browser session counters keyed by anonymous UUIDs; server-service access only.';
