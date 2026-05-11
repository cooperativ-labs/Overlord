alter table public.project_user
  add column if not exists local_version_control text not null default 'off',
  add column if not exists local_version_control_installed_at timestamptz,
  add column if not exists local_version_control_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_user_local_version_control_check'
  ) then
    alter table public.project_user
      add constraint project_user_local_version_control_check
      check (local_version_control in ('off', 'jj'));
  end if;
end $$;

create table if not exists public.project_checkpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id integer not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  objective_id uuid references public.objectives(id) on delete set null,
  session_id uuid references public.agent_sessions(id) on delete set null,
  event_id uuid references public.ticket_events(id) on delete set null,
  checkpoint_kind text not null default 'delivery',
  backend text not null,
  workspace_path text,
  workspace_name text,
  jj_change_id text,
  jj_commit_id text,
  jj_operation_id text,
  git_commit_id text,
  summary text,
  diff_stat text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

grant select on table public.project_checkpoints to authenticated;
grant all on table public.project_checkpoints to service_role;

alter table public.project_checkpoints enable row level security;

create index if not exists project_checkpoints_project_created_idx
  on public.project_checkpoints (project_id, created_at desc);

create index if not exists project_checkpoints_ticket_created_idx
  on public.project_checkpoints (ticket_id, created_at desc)
  where ticket_id is not null;

create index if not exists project_checkpoints_objective_idx
  on public.project_checkpoints (objective_id)
  where objective_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_checkpoints'
      and policyname = 'Members can select project checkpoints'
  ) then
    create policy "Members can select project checkpoints"
      on public.project_checkpoints for select
      using (
        exists (
          select 1
          from public.members om
          where om.organization_id = project_checkpoints.organization_id
            and om.user_id = auth.uid()
        )
      );
  end if;
end $$;

alter table public.file_changes
  add column if not exists checkpoint_id uuid references public.project_checkpoints(id) on delete set null;

create index if not exists file_changes_checkpoint_id_idx
  on public.file_changes (checkpoint_id)
  where checkpoint_id is not null;
