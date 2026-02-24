-- Add an Icebox status for all organizations and include it in future default seeding.

update public.ticket_statuses
set position = position + 1
where organization_id in (
  select organizations.id
  from public.organizations
  where not exists (
    select 1
    from public.ticket_statuses
    where ticket_statuses.organization_id = organizations.id
      and ticket_statuses.name = 'icebox'
  )
);

insert into public.ticket_statuses (organization_id, name, status_type, position, is_default)
select organizations.id, 'icebox', 'draft', 0, true
from public.organizations
where not exists (
  select 1
  from public.ticket_statuses
  where ticket_statuses.organization_id = organizations.id
    and ticket_statuses.name = 'icebox'
);

CREATE OR REPLACE FUNCTION public.seed_default_ticket_statuses_for_organization(target_organization_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  insert into public.ticket_statuses (organization_id, name, status_type, position, is_default)
  values
    (target_organization_id, 'icebox', 'draft', 0, true),
    (target_organization_id, 'draft', 'draft', 1, true),
    (target_organization_id, 'execute', 'execute', 2, true),
    (target_organization_id, 'review', 'review', 3, true),
    (target_organization_id, 'complete', 'complete', 4, true),
    (target_organization_id, 'blocked', 'execute', 5, true),
    (target_organization_id, 'cancelled', 'complete', 6, true)
  on conflict (organization_id, name) do nothing;
end;
$function$;
