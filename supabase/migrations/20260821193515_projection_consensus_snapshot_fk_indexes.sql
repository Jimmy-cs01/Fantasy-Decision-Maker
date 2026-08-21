create index if not exists projection_consensus_snapshots_model_version_idx
  on public.projection_consensus_snapshots (model_version_id);

create index if not exists projection_consensus_snapshots_nfl_game_idx
  on public.projection_consensus_snapshots (nfl_game_id)
  where nfl_game_id is not null;
