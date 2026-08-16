-- nflverse replaces Kaggle as the only active historical player-stat provider.
-- This migration adds provider-neutral columns and rebuilds derived views; it
-- deliberately does not delete or rewrite imported data.
alter table public.player_weekly_nfl_statistics
  add column if not exists opponent_team text,
  add column if not exists historical_position text,
  add column if not exists interceptions_thrown numeric,
  add column if not exists receiving_first_downs numeric,
  add column if not exists true_touches numeric,
  add column if not exists passing_epa numeric,
  add column if not exists passing_cpoe numeric,
  add column if not exists rushing_epa numeric,
  add column if not exists receiving_epa numeric,
  add column if not exists target_share numeric,
  add column if not exists air_yards_share numeric,
  add column if not exists wopr numeric,
  add column if not exists pacr numeric,
  add column if not exists racr numeric,
  add column if not exists source_dataset text,
  add column if not exists source_season integer;

create index if not exists weekly_stats_provider_season_type_idx
  on public.player_weekly_nfl_statistics (provider, season, season_type);

drop view if exists public.player_season_stats;

create view public.player_season_stats
with (security_invoker = true)
as
with totals as (
  select
    p.id as player_id,
    p.full_name,
    coalesce(mode() within group (order by s.historical_position), p.historical_position) as historical_position,
    p.sleeper_position,
    p.team as current_team,
    p.college,
    p.rookie_season,
    s.season,
    s.season_type,
    string_agg(distinct s.team, '/' order by s.team) filter (where s.team is not null) as season_teams,
    count(*)::integer as games_played,
    coalesce(sum(s.pass_attempts), 0) as pass_attempts,
    coalesce(sum(s.completions), 0) as completions,
    coalesce(sum(s.passing_yards), 0) as passing_yards,
    coalesce(sum(s.passing_air_yards), 0) as passing_air_yards,
    coalesce(sum(s.passing_touchdowns), 0) as passing_touchdowns,
    coalesce(sum(s.interceptions_thrown), 0) as interceptions_thrown,
    coalesce(sum(s.first_down_passes), 0) as passing_first_downs,
    coalesce(sum(s.times_sacked), 0) as times_sacked,
    sum(s.times_pressured) as times_pressured,
    coalesce(sum(s.passing_epa), 0) as passing_epa,
    sum(s.passing_cpoe * s.pass_attempts) as weighted_passing_cpoe,
    coalesce(sum(s.rush_attempts), 0) as rush_attempts,
    coalesce(sum(s.rushing_yards), 0) as rushing_yards,
    coalesce(sum(s.rushing_touchdowns), 0) as rushing_touchdowns,
    coalesce(sum(s.rushing_first_downs), 0) as rushing_first_downs,
    sum(s.rush_attempts_red_zone) as rush_attempts_red_zone,
    sum(s.rush_attempts_goal_to_go) as rush_attempts_goal_to_go,
    coalesce(sum(s.rushing_epa), 0) as rushing_epa,
    coalesce(sum(s.targets), 0) as targets,
    coalesce(sum(s.receptions), 0) as receptions,
    coalesce(sum(s.receiving_yards), 0) as receiving_yards,
    coalesce(sum(s.receiving_air_yards), 0) as receiving_air_yards,
    coalesce(sum(s.yards_after_catch), 0) as yards_after_catch,
    coalesce(sum(s.receiving_touchdowns), 0) as receiving_touchdowns,
    coalesce(sum(s.receiving_first_downs), 0) as receiving_first_downs,
    coalesce(sum(s.receiving_epa), 0) as receiving_epa,
    avg(s.target_share) as average_target_share,
    avg(s.air_yards_share) as average_air_yards_share,
    avg(s.wopr) as average_wopr,
    sum(s.offense_snaps) as offense_snaps,
    sum(s.team_offense_snaps) as team_offense_snaps,
    coalesce(sum(s.true_touches), 0) as true_touches,
    coalesce(sum(s.fantasy_points_standard), 0) as fantasy_points_standard,
    coalesce(sum(s.fantasy_points_half_ppr), 0) as fantasy_points_half_ppr,
    coalesce(sum(s.fantasy_points_ppr), 0) as fantasy_points_ppr
  from public.player_weekly_nfl_statistics s
  join public.players p on p.id = s.player_id
  where s.provider = 'nflverse'
  group by p.id, p.full_name, p.historical_position, p.sleeper_position, p.team,
    p.college, p.rookie_season, s.season, s.season_type
)
select
  totals.*,
  completions / nullif(pass_attempts, 0) as completion_percentage,
  passing_yards / nullif(pass_attempts, 0) as yards_per_pass_attempt,
  passing_air_yards / nullif(pass_attempts, 0) as pass_adot,
  null::numeric as passer_rating,
  passing_touchdowns / nullif(pass_attempts, 0) as passing_td_percentage,
  interceptions_thrown / nullif(pass_attempts, 0) as interception_percentage,
  null::numeric as pressure_percentage,
  weighted_passing_cpoe / nullif(pass_attempts, 0) as passing_cpoe,
  passing_yards / nullif(passing_air_yards, 0) as pacr,
  rushing_yards / nullif(rush_attempts, 0) as yards_per_carry,
  rushing_touchdowns / nullif(rush_attempts, 0) as rushing_td_percentage,
  rush_attempts_red_zone / nullif(rush_attempts, 0) as red_zone_rush_share,
  rush_attempts_goal_to_go / nullif(rush_attempts, 0) as goal_to_go_rush_share,
  receiving_yards / nullif(targets, 0) as yards_per_target,
  receiving_yards / nullif(receptions, 0) as yards_per_reception,
  receiving_air_yards / nullif(targets, 0) as receiving_adot,
  yards_after_catch / nullif(receptions, 0) as yards_after_catch_per_reception,
  receiving_touchdowns / nullif(targets, 0) as receiving_td_percentage,
  receiving_yards / nullif(receiving_air_yards, 0) as racr,
  offense_snaps / nullif(team_offense_snaps, 0) as snap_share,
  case when historical_position = 'QB'
    then passing_yards + rushing_yards
    else rushing_yards + receiving_yards
  end as total_yards,
  case when historical_position = 'QB'
    then passing_touchdowns + rushing_touchdowns
    else rushing_touchdowns + receiving_touchdowns
  end as total_touchdowns,
  fantasy_points_standard / nullif(games_played, 0) as fantasy_points_standard_per_game,
  fantasy_points_half_ppr / nullif(games_played, 0) as fantasy_points_half_ppr_per_game,
  fantasy_points_ppr / nullif(games_played, 0) as fantasy_points_ppr_per_game
from totals;

grant select on public.player_season_stats to authenticated;

create or replace view public.available_player_seasons
with (security_invoker = true)
as
select season, season_type, count(*)::bigint as weekly_rows
from public.player_weekly_nfl_statistics
where provider = 'nflverse'
group by season, season_type;

grant select on public.available_player_seasons to authenticated;
