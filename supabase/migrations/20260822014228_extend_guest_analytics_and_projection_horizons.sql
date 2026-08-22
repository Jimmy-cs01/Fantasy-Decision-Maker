alter table public.guest_visitors
  add column if not exists visitor_type text not null default 'anonymous'
  check (visitor_type in ('guest', 'anonymous'));

alter table public.guest_sessions
  add column if not exists visitor_type text not null default 'anonymous'
  check (visitor_type in ('guest', 'anonymous'));

create index if not exists guest_visitors_type_last_seen_idx
  on public.guest_visitors (visitor_type, last_seen desc);
create index if not exists guest_sessions_type_last_seen_idx
  on public.guest_sessions (visitor_type, last_seen desc);

create function public.record_guest_activity(
  browser_id uuid,
  browser_session_id uuid,
  visited_path text,
  visitor_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_session integer;
  safe_path text := left(nullif(trim(visited_path), ''), 300);
  safe_kind text := case when lower(visitor_kind) = 'guest' then 'guest' else 'anonymous' end;
begin
  insert into public.guest_visitors (
    anonymous_id, first_seen, last_seen, session_count, visit_count, last_path, visitor_type
  ) values (
    browser_id, now(), now(), 0, 1, safe_path, safe_kind
  )
  on conflict (anonymous_id) do update
    set last_seen = excluded.last_seen,
        visit_count = public.guest_visitors.visit_count + 1,
        last_path = excluded.last_path,
        -- A browser that ever enters Guest Mode remains classified as Guest.
        visitor_type = case
          when public.guest_visitors.visitor_type = 'guest' or excluded.visitor_type = 'guest' then 'guest'
          else 'anonymous'
        end;

  insert into public.guest_sessions (
    anonymous_id, session_id, started_at, last_seen, visit_count, last_path, visitor_type
  ) values (
    browser_id, browser_session_id, now(), now(), 1, safe_path, safe_kind
  )
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
        last_path = safe_path,
        visitor_type = case
          when visitor_type = 'guest' or safe_kind = 'guest' then 'guest'
          else 'anonymous'
        end
    where anonymous_id = browser_id and session_id = browser_session_id;
  end if;
end;
$$;

revoke all on function public.record_guest_activity(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_guest_activity(uuid, uuid, text, text)
  to service_role;

comment on column public.guest_visitors.visitor_type is
  'Anonymous browser classification. Guest means the browser entered Guest Mode; no account or league data is stored here.';
