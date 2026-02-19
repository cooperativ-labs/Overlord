alter table public.projects
  add column if not exists everhour_project_id text;

create unique index if not exists projects_org_everhour_project_id_key
  on public.projects (organization_id, everhour_project_id)
  where everhour_project_id is not null;
