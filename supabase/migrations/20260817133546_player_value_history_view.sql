create or replace view public.player_value_season_history
with (security_invoker = true)
as
select
  s.player_id,
  p.historical_position,
  s.season,
  s.season_type,
  count(*)::integer as games_played,
  coalesce(sum(s.fantasy_points_standard), 0) as fantasy_points_standard,
  coalesce(sum(s.passing_yards), 0) as passing_yards,
  coalesce(sum(s.passing_touchdowns), 0) as passing_touchdowns,
  coalesce(sum(s.interceptions_thrown), 0) as interceptions_thrown,
  coalesce(sum(s.rushing_yards), 0) as rushing_yards,
  coalesce(sum(s.rushing_touchdowns), 0) as rushing_touchdowns,
  coalesce(sum(s.receptions), 0) as receptions,
  coalesce(sum(s.receiving_yards), 0) as receiving_yards,
  coalesce(sum(s.receiving_touchdowns), 0) as receiving_touchdowns,
  coalesce(sum(s.completions), 0) as completions,
  coalesce(sum(s.pass_attempts), 0) as pass_attempts,
  coalesce(sum(s.first_down_passes), 0) as passing_first_downs,
  coalesce(sum(s.rush_attempts), 0) as rush_attempts,
  coalesce(sum(s.rushing_first_downs), 0) as rushing_first_downs,
  coalesce(sum(s.receiving_first_downs), 0) as receiving_first_downs
from public.player_weekly_nfl_statistics s
join public.players p on p.id = s.player_id
where s.provider = 'nflverse'
group by s.player_id, p.historical_position, s.season, s.season_type;

comment on view public.player_value_season_history is
  'Focused season aggregates required by projection priors and league scoring; avoids the full stats-explorer view.';

grant select on public.player_value_season_history to authenticated;
