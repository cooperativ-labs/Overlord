alter table public.projects
  add column archived_at timestamptz default null;
