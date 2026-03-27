-- Ensure every organization has at most one execute and one review status.

with ranked_statuses as (
  select
    organization_id,
    name,
    status_type,
    row_number() over (
      partition by organization_id, status_type
      order by position asc, name asc
    ) as rn
  from public.ticket_statuses
  where status_type in ('execute'::public.ticket_status_type, 'review'::public.ticket_status_type)
)
update public.ticket_statuses as ticket_statuses
set status_type = 'draft'
from ranked_statuses
where ticket_statuses.organization_id = ranked_statuses.organization_id
  and ticket_statuses.name = ranked_statuses.name
  and ranked_statuses.rn > 1;

create unique index ticket_statuses_organization_singleton_status_type_idx
  on public.ticket_statuses using btree (organization_id, status_type)
  where status_type in ('execute'::public.ticket_status_type, 'review'::public.ticket_status_type);

create or replace function public.seed_default_ticket_statuses_for_organization(target_organization_id integer)
 returns void
 language plpgsql
as $function$
begin
  insert into public.ticket_statuses (organization_id, name, status_type, position, is_default)
  values
    (target_organization_id, 'icebox', 'draft', 0, true),
    (target_organization_id, 'draft', 'draft', 1, true),
    (target_organization_id, 'execute', 'execute', 2, true),
    (target_organization_id, 'review', 'review', 3, true),
    (target_organization_id, 'complete', 'complete', 4, true),
    (target_organization_id, 'blocked', 'draft', 5, true),
    (target_organization_id, 'cancelled', 'complete', 6, true)
  on conflict (organization_id, name) do nothing;
end;
$function$;
