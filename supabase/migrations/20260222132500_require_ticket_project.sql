-- Ensure each organization with unassigned tickets has a fallback project.
insert into public.projects (organization_id, name, color)
select distinct t.organization_id, 'General', '#6b7280'
from public.tickets t
where t.project_id is null
  and not exists (
    select 1
    from public.projects p
    where p.organization_id = t.organization_id
  );

with ranked_projects as (
  select
    p.organization_id,
    p.id,
    row_number() over (partition by p.organization_id order by p.created_at asc, p.id asc) as row_num
  from public.projects p
), default_projects as (
  select organization_id, id
  from ranked_projects
  where row_num = 1
)
update public.tickets t
set project_id = d.id
from default_projects d
where t.organization_id = d.organization_id
  and t.project_id is null;

alter table public.tickets
  drop constraint if exists tickets_project_org_fkey;

alter table public.tickets
  alter column project_id set not null;

alter table public.tickets
  add constraint tickets_project_org_fkey
  foreign key (project_id, organization_id)
  references public.projects (id, organization_id)
  on update cascade
  on delete restrict
  not valid;

alter table public.tickets
  validate constraint tickets_project_org_fkey;
