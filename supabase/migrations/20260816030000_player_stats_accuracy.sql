-- Preserve additional raw/provider fields while exposing weighted, fantasy-facing
-- season metrics through the view. Existing weekly rows remain untouched.
alter table public.player_weekly_nfl_statistics
  add column if not exists rushing_first_downs numeric,
  add column if not exists source_passing_td_percentage numeric,
  add column if not exists source_interception_percentage numeric,
  add column if not exists source_rushing_td_percentage numeric,
  add column if not exists source_receiving_td_percentage numeric;

-- PostgreSQL cannot replace a view when its column layout changes. Migrations run
-- transactionally, so dropping and recreating the derived view is safe and does not
-- alter any imported player or weekly-stat rows.
drop view if exists public.player_season_stats;

create view public.player_season_stats
with (security_invoker = true)
as
with totals as (
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
    string_agg(distinct s.team, '/' order by s.team) filter (where s.team is not null) as season_teams,
    count(*)::integer as games_played,
    coalesce(sum(s.pass_attempts), 0) as pass_attempts,
    coalesce(sum(s.completions), 0) as completions,
    coalesce(sum(s.passing_yards), 0) as passing_yards,
    coalesce(sum(s.passing_air_yards), 0) as passing_air_yards,
    coalesce(sum(s.passing_touchdowns), 0) as passing_touchdowns,
    coalesce(sum(s.interceptions), 0) as raw_interceptions,
    coalesce(sum(s.first_down_passes), 0) as passing_first_downs,
    coalesce(sum(s.times_sacked), 0) as times_sacked,
    coalesce(sum(s.times_pressured), 0) as times_pressured,
    coalesce(sum(s.pass_adot * s.pass_attempts), 0) as weighted_pass_adot,
    coalesce(sum(s.passer_rating * s.pass_attempts), 0) as weighted_passer_rating,
    coalesce(sum(s.rush_attempts), 0) as rush_attempts,
    coalesce(sum(s.rushing_yards), 0) as rushing_yards,
    coalesce(sum(s.rushing_touchdowns), 0) as rushing_touchdowns,
    coalesce(sum(s.rushing_first_downs), 0) as rushing_first_downs,
    coalesce(sum(s.rush_attempts_red_zone), 0) as rush_attempts_red_zone,
    coalesce(sum(s.rush_attempts_goal_to_go), 0) as rush_attempts_goal_to_go,
    coalesce(sum(s.targets), 0) as targets,
    coalesce(sum(s.receptions), 0) as receptions,
    coalesce(sum(s.receiving_yards), 0) as receiving_yards,
    coalesce(sum(s.receiving_air_yards), 0) as receiving_air_yards,
    coalesce(sum(s.yards_after_catch), 0) as yards_after_catch,
    coalesce(sum(s.receiving_touchdowns), 0) as receiving_touchdowns,
    coalesce(sum(s.receiving_adot * s.targets), 0) as weighted_receiving_adot,
    coalesce(sum(s.offense_snaps), 0) as offense_snaps,
    coalesce(sum(s.team_offense_snaps), 0) as team_offense_snaps,
    coalesce(sum(s.fantasy_points_standard), 0) as fantasy_points_standard,
    coalesce(sum(s.fantasy_points_half_ppr), 0) as fantasy_points_half_ppr,
    coalesce(sum(s.fantasy_points_ppr), 0) as fantasy_points_ppr
  from public.player_weekly_nfl_statistics s
  join public.players p on p.id = s.player_id
  group by p.id, p.full_name, p.historical_position, p.sleeper_position, p.team,
    p.college, p.rookie_season, s.season, s.season_type
)
select
  totals.*,
  case when pass_attempts > 0 then raw_interceptions else 0 end as interceptions_thrown,
  completions / nullif(pass_attempts, 0) as completion_percentage,
  passing_yards / nullif(pass_attempts, 0) as yards_per_pass_attempt,
  weighted_pass_adot / nullif(pass_attempts, 0) as pass_adot,
  weighted_passer_rating / nullif(pass_attempts, 0) as passer_rating,
  passing_touchdowns / nullif(pass_attempts, 0) as passing_td_percentage,
  (case when pass_attempts > 0 then raw_interceptions else 0 end) / nullif(pass_attempts, 0) as interception_percentage,
  times_pressured / nullif(pass_attempts + times_sacked, 0) as pressure_percentage,
  rushing_yards / nullif(rush_attempts, 0) as yards_per_carry,
  rushing_touchdowns / nullif(rush_attempts, 0) as rushing_td_percentage,
  rush_attempts_red_zone / nullif(rush_attempts, 0) as red_zone_rush_share,
  rush_attempts_goal_to_go / nullif(rush_attempts, 0) as goal_to_go_rush_share,
  receiving_yards / nullif(targets, 0) as yards_per_target,
  receiving_yards / nullif(receptions, 0) as yards_per_reception,
  weighted_receiving_adot / nullif(targets, 0) as receiving_adot,
  yards_after_catch / nullif(receptions, 0) as yards_after_catch_per_reception,
  receiving_touchdowns / nullif(targets, 0) as receiving_td_percentage,
  offense_snaps / nullif(team_offense_snaps, 0) as snap_share,
  rush_attempts + receptions as true_touches,
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
