alter table public.ticket_identifier_counters enable row level security;

grant select, insert, update, delete on table public.ticket_identifier_counters to authenticated;
grant select, insert, update, delete on table public.ticket_identifier_counters to service_role;

create policy "ticket_identifier_counters_select_member"
on public.ticket_identifier_counters
as permissive
for select
to authenticated
using (public.is_org_member(organization_id));

create policy "ticket_identifier_counters_insert_member"
on public.ticket_identifier_counters
as permissive
for insert
to authenticated
with check (public.is_org_member(organization_id));

create policy "ticket_identifier_counters_update_member"
on public.ticket_identifier_counters
as permissive
for update
to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
