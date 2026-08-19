-- Guest mode reads only provider/public NFL analytics. Sleeper league ownership
-- remains ephemeral and every user-owned Jimmy GM table stays inaccessible to
-- the anon role. Grants and RLS are both required by the Supabase Data API.

alter table public.players enable row level security;
alter table public.player_weekly_nfl_statistics enable row level security;
alter table public.model_versions enable row level security;
alter table public.player_projections enable row level security;
alter table public.player_depth_chart_roles enable row level security;
alter table public.nfl_games enable row level security;
alter table public.odds_games enable row level security;
alter table public.player_props enable row level security;

drop policy if exists "Anonymous users can read players" on public.players;
create policy "Anonymous users can read players"
  on public.players for select to anon using (true);

drop policy if exists "Anonymous users can read NFL statistics" on public.player_weekly_nfl_statistics;
create policy "Anonymous users can read NFL statistics"
  on public.player_weekly_nfl_statistics for select to anon using (true);

drop policy if exists "Anonymous users can read model versions" on public.model_versions;
create policy "Anonymous users can read model versions"
  on public.model_versions for select to anon using (true);

drop policy if exists "Anonymous users can read projections" on public.player_projections;
create policy "Anonymous users can read projections"
  on public.player_projections for select to anon using (true);

drop policy if exists "Anonymous users can read depth chart roles" on public.player_depth_chart_roles;
create policy "Anonymous users can read depth chart roles"
  on public.player_depth_chart_roles for select to anon using (true);

drop policy if exists "Anonymous users can read NFL games" on public.nfl_games;
create policy "Anonymous users can read NFL games"
  on public.nfl_games for select to anon using (true);

drop policy if exists "Anonymous users can read odds games" on public.odds_games;
create policy "Anonymous users can read odds games"
  on public.odds_games for select to anon using (true);

drop policy if exists "Anonymous users can read player props" on public.player_props;
create policy "Anonymous users can read player props"
  on public.player_props for select to anon using (true);

grant select on table
  public.players,
  public.player_weekly_nfl_statistics,
  public.model_versions,
  public.player_projections,
  public.player_depth_chart_roles,
  public.nfl_games,
  public.odds_games,
  public.player_props
to anon;

-- Each view is already SECURITY INVOKER, so its underlying public-table RLS
-- policies continue to apply to anonymous callers.
alter view public.player_season_stats set (security_invoker = true);
alter view public.available_player_seasons set (security_invoker = true);
alter view public.player_value_season_history set (security_invoker = true);
alter view public.odds_games_consensus set (security_invoker = true);
alter view public.player_props_consensus set (security_invoker = true);

grant select on table
  public.player_season_stats,
  public.available_player_seasons,
  public.player_value_season_history,
  public.odds_games_consensus,
  public.player_props_consensus
to anon;

-- Defense-in-depth: document and enforce that this migration does not grant
-- anonymous access to private account, ownership, roster, or sync records.
revoke all on table
  public.sleeper_accounts,
  public.yahoo_accounts,
  public.leagues,
  public.league_members,
  public.fantasy_teams,
  public.rosters,
  public.roster_players,
  public.player_fantasy_statistics,
  public.synchronization_records
from anon;
