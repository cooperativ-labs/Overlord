-- Enforce unique project names within each organization (case- and
-- surrounding-whitespace insensitive), matching ticket status naming rules.

-- Resolve any pre-existing duplicates so the unique index can apply. Keep the
-- oldest row's name unchanged; suffix later duplicates with " (2)", " (3)", …
with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, lower(btrim(name))
      order by created_at asc, id asc
    ) as rn
  from public.projects
)
update public.projects p
set name = p.name || ' (' || r.rn::text || ')'
from ranked r
where p.id = r.id
  and r.rn > 1;

create unique index if not exists projects_organization_id_name_key
  on public.projects using btree (organization_id, lower(btrim(name)));

comment on index public.projects_organization_id_name_key is
  'Project display names are unique per organization (case- and trim-insensitive).';
