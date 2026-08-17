-- The NFL draft had more than seven rounds before 1994. nflverse includes
-- legitimate historical selections through round 17, so validate positivity
-- without imposing the modern seven-round format on historical records.
alter table public.players
  drop constraint if exists players_draft_round_check,
  add constraint players_draft_round_check
    check (draft_round is null or draft_round > 0);
