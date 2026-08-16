-- Preserve Sleeper's starter-array position so repeated/flexible lineup slots
-- can be rendered deterministically without inferring assignments.
alter table public.roster_players
  add column if not exists roster_slot_index integer;

create index if not exists roster_players_roster_order_idx
  on public.roster_players (roster_id, is_starter desc, roster_slot_index);

