alter table public.players
  add column if not exists draft_year integer,
  add column if not exists draft_round integer,
  add column if not exists draft_pick integer,
  add column if not exists draft_team text,
  add column if not exists draft_status text,
  add column if not exists draft_source text,
  add column if not exists draft_updated_at timestamptz;

alter table public.players
  drop constraint if exists players_draft_status_check,
  add constraint players_draft_status_check
    check (draft_status is null or draft_status in ('drafted', 'undrafted', 'unknown')),
  drop constraint if exists players_draft_round_check,
  add constraint players_draft_round_check
    check (draft_round is null or draft_round between 1 and 7),
  drop constraint if exists players_draft_pick_check,
  add constraint players_draft_pick_check
    check (draft_pick is null or draft_pick > 0);

comment on column public.players.draft_status is
  'drafted, explicitly inferred undrafted from nflverse/PFR coverage, or unknown; null means not yet enriched';
comment on column public.players.draft_source is
  'Provider/version responsible for the current draft metadata.';

create or replace function public.update_player_draft_capital(records jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with incoming as (
    select *
    from jsonb_to_recordset(records) as item(
      id uuid,
      draft_year integer,
      draft_round integer,
      draft_pick integer,
      draft_team text,
      draft_status text,
      draft_source text,
      draft_updated_at timestamptz
    )
  ), updated as (
    update public.players as player
    set
      draft_year = incoming.draft_year,
      draft_round = incoming.draft_round,
      draft_pick = incoming.draft_pick,
      draft_team = incoming.draft_team,
      draft_status = incoming.draft_status,
      draft_source = incoming.draft_source,
      draft_updated_at = incoming.draft_updated_at,
      updated_at = now()
    from incoming
    where player.id = incoming.id
    returning player.id
  )
  select count(*)::integer from updated;
$$;

revoke all on function public.update_player_draft_capital(jsonb) from public;
grant execute on function public.update_player_draft_capital(jsonb) to service_role;
