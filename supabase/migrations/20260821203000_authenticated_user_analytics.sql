create table public.authenticated_user_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  path text not null check (char_length(path) between 1 and 300 and left(path, 1) = '/'),
  feature_key text not null check (char_length(feature_key) between 1 and 80),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, session_id, path)
);

create index authenticated_user_activity_last_seen_idx
  on public.authenticated_user_activity (last_seen_at desc);
create index authenticated_user_activity_user_last_seen_idx
  on public.authenticated_user_activity (user_id, last_seen_at desc);
create index authenticated_user_activity_feature_last_seen_idx
  on public.authenticated_user_activity (feature_key, last_seen_at desc);

alter table public.authenticated_user_activity enable row level security;
revoke all on table public.authenticated_user_activity from public, anon, authenticated;
grant select, insert, update on table public.authenticated_user_activity to service_role;
create policy "Deny browser access to authenticated analytics"
  on public.authenticated_user_activity
  for all to anon, authenticated
  using (false)
  with check (false);

create or replace function public.record_authenticated_activity(
  account_id uuid,
  browser_session_id uuid,
  visited_path text,
  visited_feature text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_path text := left(nullif(trim(visited_path), ''), 300);
  safe_feature text := left(nullif(trim(visited_feature), ''), 80);
begin
  if safe_path is null or left(safe_path, 1) <> '/' or safe_feature is null then
    raise exception 'Invalid authenticated activity event';
  end if;

  if not exists (
    select 1 from auth.users
    where id = account_id and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'Registered account not found';
  end if;

  insert into public.authenticated_user_activity (
    user_id, session_id, path, feature_key, first_seen_at, last_seen_at
  ) values (
    account_id, browser_session_id, safe_path, safe_feature, now(), now()
  )
  on conflict (user_id, session_id, path) do update
    set last_seen_at = excluded.last_seen_at,
        feature_key = excluded.feature_key;
end;
$$;

revoke all on function public.record_authenticated_activity(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_authenticated_activity(uuid, uuid, text, text)
  to service_role;

comment on table public.authenticated_user_activity is
  'Server-only registered-account feature activity. Auth user IDs are never mixed with anonymous guest analytics.';
