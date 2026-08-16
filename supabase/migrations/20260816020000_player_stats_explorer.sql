create extension if not exists pg_trgm;

alter table public.players
  add column if not exists height integer,
  add column if not exists weight integer,
  add column if not exists sleeper_fantasy_positions text[] not null default '{}'::text[];

drop index if exists public.players_gsis_id_unique_idx;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.players'::regclass and conname = 'players_gsis_id_key'
  ) then
    alter table public.players add constraint players_gsis_id_key unique (gsis_id);
  end if;
end $$;

create index if not exists players_full_name_trgm_idx
  on public.players using gin (lower(full_name) gin_trgm_ops);
create index if not exists players_historical_position_idx on public.players (historical_position);
create index if not exists players_sleeper_position_idx on public.players (sleeper_position);
create index if not exists weekly_stats_season_type_idx
  on public.player_weekly_nfl_statistics (season, season_type);

alter table public.player_weekly_nfl_statistics
  add column if not exists pass_attempts numeric,
  add column if not exists completions numeric,
  add column if not exists passing_yards numeric,
  add column if not exists passing_air_yards numeric,
  add column if not exists completion_percentage numeric,
  add column if not exists yards_per_attempt numeric,
  add column if not exists pass_adot numeric,
  add column if not exists passer_rating numeric,
  add column if not exists passing_touchdowns numeric,
  add column if not exists interceptions numeric,
  add column if not exists first_down_passes numeric,
  add column if not exists times_sacked numeric,
  add column if not exists times_pressured numeric,
  add column if not exists pressure_percentage numeric,
  add column if not exists targets numeric,
  add column if not exists receptions numeric,
  add column if not exists receiving_yards numeric,
  add column if not exists receiving_air_yards numeric,
  add column if not exists yards_after_catch numeric,
  add column if not exists yards_per_target numeric,
  add column if not exists yards_per_reception numeric,
  add column if not exists receiving_adot numeric,
  add column if not exists receiving_touchdowns numeric,
  add column if not exists rush_attempts numeric,
  add column if not exists rush_attempts_red_zone numeric,
  add column if not exists rush_attempts_goal_to_go numeric,
  add column if not exists rushing_yards numeric,
  add column if not exists yards_per_carry numeric,
  add column if not exists rushing_touchdowns numeric,
  add column if not exists rushing_touchdowns_red_zone numeric,
  add column if not exists rushing_touchdowns_goal_to_go numeric,
  add column if not exists offense_snaps numeric,
  add column if not exists team_offense_snaps numeric,
  add column if not exists offense_snap_percentage numeric,
  add column if not exists touches numeric,
  add column if not exists total_yards numeric,
  add column if not exists total_touchdowns numeric,
  add column if not exists fantasy_points_standard numeric,
  add column if not exists fantasy_points_half_ppr numeric,
  add column if not exists fantasy_points_ppr numeric;

create or replace view public.player_season_stats
with (security_invoker = true)
as
select
  p.id as player_id,
  p.full_name,
  p.historical_position,
  p.sleeper_position,
  p.team as current_team,
  p.college,
  p.rookie_season,
  s.season,
  s.season_type,
  count(*)::integer as games_played,
  coalesce(sum(s.pass_attempts), 0) as pass_attempts,
  coalesce(sum(s.completions), 0) as completions,
  coalesce(sum(s.passing_yards), 0) as passing_yards,
  coalesce(sum(s.passing_touchdowns), 0) as passing_touchdowns,
  coalesce(sum(s.interceptions), 0) as interceptions,
  coalesce(sum(s.targets), 0) as targets,
  coalesce(sum(s.receptions), 0) as receptions,
  coalesce(sum(s.receiving_yards), 0) as receiving_yards,
  coalesce(sum(s.receiving_air_yards), 0) as receiving_air_yards,
  coalesce(sum(s.yards_after_catch), 0) as yards_after_catch,
  coalesce(sum(s.receiving_touchdowns), 0) as receiving_touchdowns,
  coalesce(sum(s.rush_attempts), 0) as rush_attempts,
  coalesce(sum(s.rushing_yards), 0) as rushing_yards,
  coalesce(sum(s.rushing_touchdowns), 0) as rushing_touchdowns,
  coalesce(sum(s.touches), 0) as touches,
  coalesce(sum(s.total_yards), 0) as total_yards,
  coalesce(sum(s.total_touchdowns), 0) as total_touchdowns,
  coalesce(avg(s.offense_snap_percentage), 0) as average_snap_percentage,
  coalesce(sum(s.fantasy_points_standard), 0) as fantasy_points_standard,
  coalesce(sum(s.fantasy_points_half_ppr), 0) as fantasy_points_half_ppr,
  coalesce(sum(s.fantasy_points_ppr), 0) as fantasy_points_ppr,
  coalesce(sum(s.fantasy_points_standard) / nullif(count(*), 0), 0) as fantasy_points_standard_per_game,
  coalesce(sum(s.fantasy_points_half_ppr) / nullif(count(*), 0), 0) as fantasy_points_half_ppr_per_game,
  coalesce(sum(s.fantasy_points_ppr) / nullif(count(*), 0), 0) as fantasy_points_ppr_per_game
from public.player_weekly_nfl_statistics s
join public.players p on p.id = s.player_id
group by p.id, p.full_name, p.historical_position, p.sleeper_position, p.team,
  p.college, p.rookie_season, s.season, s.season_type;

grant select on public.player_season_stats to authenticated;

create or replace view public.available_player_seasons
with (security_invoker = true)
as
select season, season_type, count(*)::bigint as weekly_rows
from public.player_weekly_nfl_statistics
group by season, season_type;

grant select on public.available_player_seasons to authenticated;
