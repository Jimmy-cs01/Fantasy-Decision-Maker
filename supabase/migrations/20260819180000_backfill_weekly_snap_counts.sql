create or replace function public.update_player_weekly_snap_counts(records jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with incoming as (
    select *
    from jsonb_to_recordset(records) as item(
      player_id uuid,
      season integer,
      week integer,
      season_type text,
      team text,
      offense_snaps integer,
      team_offense_snaps integer,
      offense_snap_percentage numeric
    )
  ), updated as (
    update public.player_weekly_nfl_statistics as weekly
    set
      offense_snaps = incoming.offense_snaps,
      team_offense_snaps = incoming.team_offense_snaps,
      offense_snap_percentage = incoming.offense_snap_percentage,
      updated_at = now()
    from incoming
    where weekly.player_id = incoming.player_id
      and weekly.season = incoming.season
      and weekly.week = incoming.week
      and weekly.season_type = incoming.season_type
      and weekly.team = incoming.team
      and weekly.provider = 'nflverse'
    returning weekly.id
  )
  select count(*)::integer from updated;
$$;

revoke all on function public.update_player_weekly_snap_counts(jsonb) from public;
grant execute on function public.update_player_weekly_snap_counts(jsonb) to service_role;

comment on function public.update_player_weekly_snap_counts(jsonb) is
  'Service-only, update-only backfill for trusted nflverse/PFR weekly snap fields.';
