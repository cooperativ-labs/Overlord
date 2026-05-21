alter type public.ticket_event_type add value if not exists 'execution_requested';
alter type public.ticket_event_type add value if not exists 'execution_launch_failed';

create table public.execution_requests (
  id uuid default gen_random_uuid() primary key,
  organization_id integer not null references public.organizations(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_from text not null,
  agent_identifier text not null,
  model_identifier text,
  thinking_level text,
  launch_mode text not null default 'run',
  launch_params jsonb not null default '{}'::jsonb,
  target_device_id uuid references public.devices(id) on delete set null,
  target_resource_id uuid references public.project_resource_directories(id) on delete set null,
  target_kind text not null default 'any',
  status text not null default 'queued',
  claimed_by_device_id uuid references public.devices(id) on delete set null,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  launched_session_id uuid references public.agent_sessions(id) on delete set null,
  launched_at timestamptz,
  failed_at timestamptz,
  last_error text,
  attempt_count integer not null default 0,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  constraint execution_requests_status_check check (
    status in ('queued', 'claimed', 'launching', 'launched', 'failed', 'cancelled', 'expired')
  ),
  constraint execution_requests_launch_mode_check check (launch_mode in ('run', 'ask')),
  constraint execution_requests_target_kind_check check (target_kind in ('any', 'local', 'ssh'))
);

create index execution_requests_queue_idx
  on public.execution_requests (organization_id, status, created_at);

create index execution_requests_ticket_idx
  on public.execution_requests (ticket_id, created_at desc);

create index execution_requests_objective_idx
  on public.execution_requests (objective_id, created_at desc);

create index execution_requests_claimed_device_idx
  on public.execution_requests (claimed_by_device_id)
  where claimed_by_device_id is not null;

alter table public.execution_requests enable row level security;

create policy "execution_requests_select_requester_or_org_admin"
  on public.execution_requests for select to authenticated
  using (
    requested_by = (select auth.uid())
    or public.has_org_role(organization_id, ARRAY['ADMIN'::public.organization_role])
  );

create policy "execution_requests_insert_requester"
  on public.execution_requests for insert to authenticated
  with check (requested_by = (select auth.uid()));

create policy "execution_requests_update_requester"
  on public.execution_requests for update to authenticated
  using (requested_by = (select auth.uid()))
  with check (requested_by = (select auth.uid()));

create policy "execution_requests_delete_requester"
  on public.execution_requests for delete to authenticated
  using (requested_by = (select auth.uid()));

create or replace function public.touch_execution_requests_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger execution_requests_set_updated_at
  before update on public.execution_requests
  for each row execute function public.touch_execution_requests_updated_at();
