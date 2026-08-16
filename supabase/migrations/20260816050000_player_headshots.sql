-- Store the latest trusted nflverse/NFL portrait once per canonical player.
-- The historical importer preserves an existing URL when incoming data is null.
alter table public.players
  add column if not exists headshot_url text;

comment on column public.players.headshot_url is
  'Latest non-null nflverse player headshot URL; nullable with UI fallback.';
