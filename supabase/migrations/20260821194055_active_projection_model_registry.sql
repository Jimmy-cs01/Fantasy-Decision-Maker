alter table public.model_versions
  add column if not exists is_active boolean not null default false;

-- Preserve the current production model during the application rollout. The
-- release process switches this flag only after the registry-aware deployment
-- has been verified.
update public.model_versions
set is_active = (version = 'v3.3.2')
where not exists (
  select 1 from public.model_versions where is_active
);

create unique index if not exists model_versions_one_active_idx
  on public.model_versions (is_active)
  where is_active;

comment on column public.model_versions.is_active is
  'Explicit production selector. generated_at never activates an experimental model.';
