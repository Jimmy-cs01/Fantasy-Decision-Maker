-- Historical imports use GSIS/Kaggle IDs as external identities; UUIDs remain primary keys.
alter table public.players
  add column if not exists gsis_id text,
  add column if not exists pfr_player_id text,
  add column if not exists historical_position text,
  add column if not exists sleeper_position text,
  add column if not exists birth_date date,
  add column if not exists college text,
  add column if not exists rookie_season integer;

create unique index if not exists players_gsis_id_unique_idx on public.players (gsis_id) where gsis_id is not null;
create index if not exists players_pfr_player_id_idx on public.players (pfr_player_id) where pfr_player_id is not null;

-- A player can have more than one game in a week; game and season type make a raw
-- weekly source record unambiguous. The existing jsonb stats column stores the ETL's
-- numeric payload without coupling the initial schema to a particular data vendor.
alter table public.player_weekly_nfl_statistics
  add column if not exists game_id text,
  add column if not exists team text,
  add column if not exists season_type text;

alter table public.player_weekly_nfl_statistics
  drop constraint if exists player_weekly_nfl_statistics_player_id_season_week_provider_key;

alter table public.player_weekly_nfl_statistics
  add constraint player_weekly_nfl_statistics_player_season_week_game_provider_key
  unique (player_id, season, week, season_type, game_id, provider);

create index if not exists player_weekly_nfl_statistics_game_idx
  on public.player_weekly_nfl_statistics (season, week, season_type, game_id);
