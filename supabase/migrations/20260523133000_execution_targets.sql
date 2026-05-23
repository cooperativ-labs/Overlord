-- Canonical execution targets replace per-user device identity and legacy
-- mobile servers as the source of truth for where agents can execute.

create table if not exists public.execution_targets (
  id uuid default gen_random_uuid() primary key,
  device_fingerprint text,
  placeholder_key text,
  is_placeholder boolean not null default false,
  host text not null default '',
  port integer not null default 22,
  name text,
  transport text not null default 'local',
  platform text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint execution_targets_identity_check check (
    (is_placeholder and placeholder_key is not null)
    or (not is_placeholder and device_fingerprint is not null)
  ),
  constraint execution_targets_transport_check check (
    transport in ('local', 'ssh', 'tailscale_ssh')
  ),
  constraint execution_targets_port_check check (port > 0 and port <= 65535)
);

create unique index if not exists execution_targets_device_fingerprint_uidx
  on public.execution_targets (device_fingerprint)
  where device_fingerprint is not null;

create unique index if not exists execution_targets_placeholder_key_uidx
  on public.execution_targets (placeholder_key)
  where placeholder_key is not null;

create table if not exists public.organization_execution_targets (
  organization_id integer not null references public.organizations(id) on delete cascade,
  execution_target_id uuid not null references public.execution_targets(id) on delete cascade,
  label text not null,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, execution_target_id),
  unique (organization_id, label),
  constraint organization_execution_targets_label_format check (
    label ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'
  )
);

create index if not exists organization_execution_targets_target_idx
  on public.organization_execution_targets (execution_target_id);

create table if not exists public.user_execution_targets (
  user_id uuid not null references auth.users(id) on delete cascade,
  execution_target_id uuid not null references public.execution_targets(id) on delete cascade,
  default_username text,
  access_status text not null default 'active',
  last_connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, execution_target_id),
  constraint user_execution_targets_access_status_check check (
    access_status in ('active', 'pending', 'disabled', 'error')
  )
);

create index if not exists user_execution_targets_target_idx
  on public.user_execution_targets (execution_target_id);

create table if not exists public.execution_target_ssh_credentials (
  id uuid default gen_random_uuid() primary key,
  execution_target_id uuid not null references public.execution_targets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  auth_method text not null default 'agent',
  private_key_path text,
  public_key_fingerprint text,
  host_key_fingerprint text,
  secure_enclave_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (execution_target_id, user_id, username, auth_method),
  constraint execution_target_ssh_credentials_auth_method_check check (
    auth_method in ('agent', 'key', 'tailscale')
  )
);

create index if not exists execution_target_ssh_credentials_user_idx
  on public.execution_target_ssh_credentials (user_id);

create table if not exists public.project_execution_targets (
  project_id uuid not null references public.projects(id) on delete cascade,
  execution_target_id uuid not null references public.execution_targets(id) on delete cascade,
  organization_id integer not null references public.organizations(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, execution_target_id)
);

create index if not exists project_execution_targets_target_idx
  on public.project_execution_targets (execution_target_id);

alter table public.project_resource_directories
  add column if not exists execution_target_id uuid references public.execution_targets(id) on delete cascade;

alter table public.execution_requests
  add column if not exists target_execution_target_id uuid references public.execution_targets(id) on delete set null,
  add column if not exists claimed_by_execution_target_id uuid references public.execution_targets(id) on delete set null;

insert into public.execution_targets (
  device_fingerprint,
  placeholder_key,
  is_placeholder,
  host,
  port,
  name,
  transport,
  platform,
  last_seen_at,
  created_at,
  updated_at
)
select distinct on (d.device_fingerprint)
  d.device_fingerprint,
  case when d.is_placeholder then d.device_fingerprint else null end,
  d.is_placeholder,
  coalesce(d.hostname, ''),
  22,
  d.label,
  case when d.platform = 'ssh' or d.is_placeholder then 'ssh' else 'local' end,
  d.platform,
  d.last_seen_at,
  d.created_at,
  d.updated_at
from public.devices d
where d.device_fingerprint is not null
on conflict (device_fingerprint) where device_fingerprint is not null do update
set
  host = excluded.host,
  name = excluded.name,
  transport = excluded.transport,
  platform = excluded.platform,
  last_seen_at = excluded.last_seen_at,
  updated_at = now();

insert into public.organization_execution_targets (
  organization_id,
  execution_target_id,
  label,
  added_by,
  created_at,
  updated_at
)
select
  d.organization_id,
  et.id,
  d.label,
  d.user_id,
  d.created_at,
  d.updated_at
from public.devices d
join public.execution_targets et
  on et.device_fingerprint = d.device_fingerprint
on conflict (organization_id, execution_target_id) do update
set label = excluded.label, updated_at = now();

insert into public.user_execution_targets (
  user_id,
  execution_target_id,
  access_status,
  last_connected_at,
  created_at,
  updated_at
)
select
  d.user_id,
  et.id,
  'active',
  d.last_seen_at,
  d.created_at,
  d.updated_at
from public.devices d
join public.execution_targets et
  on et.device_fingerprint = d.device_fingerprint
on conflict (user_id, execution_target_id) do update
set last_connected_at = excluded.last_connected_at, updated_at = now();

update public.project_resource_directories prd
set execution_target_id = et.id
from public.devices d
join public.execution_targets et
  on et.device_fingerprint = d.device_fingerprint
where prd.device_id = d.id
  and prd.execution_target_id is null;

delete from public.project_resource_directories
where execution_target_id is null;

insert into public.project_execution_targets (
  project_id,
  execution_target_id,
  organization_id,
  added_by
)
select distinct
  prd.project_id,
  prd.execution_target_id,
  p.organization_id,
  prd.user_id
from public.project_resource_directories prd
join public.projects p on p.id = prd.project_id
where prd.execution_target_id is not null
on conflict (project_id, execution_target_id) do nothing;

update public.execution_requests er
set target_execution_target_id = et.id
from public.devices d
join public.execution_targets et
  on et.device_fingerprint = d.device_fingerprint
where er.target_device_id = d.id
  and er.target_execution_target_id is null;

update public.execution_requests er
set claimed_by_execution_target_id = et.id
from public.devices d
join public.execution_targets et
  on et.device_fingerprint = d.device_fingerprint
where er.claimed_by_device_id = d.id
  and er.claimed_by_execution_target_id is null;

alter table public.project_resource_directories
  alter column execution_target_id set not null;

drop index if exists project_resource_directories_one_primary_per_device_idx;

alter table public.project_resource_directories
  drop constraint if exists project_resource_directories_project_id_user_id_device_id_directory_path_key;

create unique index if not exists project_resource_directories_target_path_uidx
  on public.project_resource_directories (project_id, execution_target_id, directory_path);

create unique index if not exists project_resource_directories_primary_target_uidx
  on public.project_resource_directories (project_id, execution_target_id)
  where is_primary;

create index if not exists project_resource_directories_execution_target_idx
  on public.project_resource_directories (execution_target_id);

create index if not exists execution_requests_target_execution_target_idx
  on public.execution_requests (target_execution_target_id)
  where target_execution_target_id is not null;

create index if not exists execution_requests_claimed_execution_target_idx
  on public.execution_requests (claimed_by_execution_target_id)
  where claimed_by_execution_target_id is not null;

create or replace function public.generate_execution_target_label(
  org_id integer,
  hostname text,
  platform text
) returns text language plpgsql as $$
declare
  base text;
  candidate text;
  suffix integer := 2;
begin
  base := public.sanitize_device_label_candidate(hostname);
  if base is null then
    base := public.sanitize_device_label_candidate(platform);
    if base is not null then
      base := base || '-target';
    end if;
  end if;
  if base is null then
    base := 'target';
  end if;

  candidate := base;
  while exists (
    select 1
    from public.organization_execution_targets
    where organization_id = org_id and label = candidate
  ) loop
    candidate := base || '-' || suffix::text;
    suffix := suffix + 1;
  end loop;
  return candidate;
end;
$$;

create or replace function public.touch_execution_targets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.touch_organization_execution_targets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.touch_user_execution_targets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.touch_execution_target_ssh_credentials_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.touch_project_execution_targets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists execution_targets_set_updated_at on public.execution_targets;
create trigger execution_targets_set_updated_at
  before update on public.execution_targets
  for each row execute function public.touch_execution_targets_updated_at();

drop trigger if exists organization_execution_targets_set_updated_at on public.organization_execution_targets;
create trigger organization_execution_targets_set_updated_at
  before update on public.organization_execution_targets
  for each row execute function public.touch_organization_execution_targets_updated_at();

drop trigger if exists user_execution_targets_set_updated_at on public.user_execution_targets;
create trigger user_execution_targets_set_updated_at
  before update on public.user_execution_targets
  for each row execute function public.touch_user_execution_targets_updated_at();

drop trigger if exists execution_target_ssh_credentials_set_updated_at on public.execution_target_ssh_credentials;
create trigger execution_target_ssh_credentials_set_updated_at
  before update on public.execution_target_ssh_credentials
  for each row execute function public.touch_execution_target_ssh_credentials_updated_at();

drop trigger if exists project_execution_targets_set_updated_at on public.project_execution_targets;
create trigger project_execution_targets_set_updated_at
  before update on public.project_execution_targets
  for each row execute function public.touch_project_execution_targets_updated_at();

alter table public.execution_targets enable row level security;
alter table public.organization_execution_targets enable row level security;
alter table public.user_execution_targets enable row level security;
alter table public.execution_target_ssh_credentials enable row level security;
alter table public.project_execution_targets enable row level security;

create policy "execution_targets_select_accessible"
  on public.execution_targets for select to authenticated
  using (
    id in (
      select execution_target_id
      from public.user_execution_targets
      where user_id = (select auth.uid())
    )
    or id in (
      select execution_target_id
      from public.organization_execution_targets
      where public.has_org_role(organization_id, ARRAY['ADMIN'::public.organization_role])
    )
  );

create policy "organization_execution_targets_select_member"
  on public.organization_execution_targets for select to authenticated
  using (
    public.has_org_role(organization_id, ARRAY[
      'ADMIN'::public.organization_role,
      'VIEWER'::public.organization_role,
      'AGENT'::public.organization_role,
      'MANAGER'::public.organization_role
    ])
  );

create policy "organization_execution_targets_insert_admin"
  on public.organization_execution_targets for insert to authenticated
  with check (public.has_org_role(organization_id, ARRAY['ADMIN'::public.organization_role]));

create policy "organization_execution_targets_update_admin"
  on public.organization_execution_targets for update to authenticated
  using (public.has_org_role(organization_id, ARRAY['ADMIN'::public.organization_role]))
  with check (public.has_org_role(organization_id, ARRAY['ADMIN'::public.organization_role]));

create policy "organization_execution_targets_delete_admin"
  on public.organization_execution_targets for delete to authenticated
  using (public.has_org_role(organization_id, ARRAY['ADMIN'::public.organization_role]));

create policy "user_execution_targets_select_self"
  on public.user_execution_targets for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_execution_targets_insert_self"
  on public.user_execution_targets for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_execution_targets_update_self"
  on public.user_execution_targets for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "user_execution_targets_delete_self"
  on public.user_execution_targets for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "execution_target_ssh_credentials_select_self"
  on public.execution_target_ssh_credentials for select to authenticated
  using (user_id = (select auth.uid()));

create policy "execution_target_ssh_credentials_insert_self"
  on public.execution_target_ssh_credentials for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "execution_target_ssh_credentials_update_self"
  on public.execution_target_ssh_credentials for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "execution_target_ssh_credentials_delete_self"
  on public.execution_target_ssh_credentials for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "project_execution_targets_select_project_member"
  on public.project_execution_targets for select to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_id
        and public.has_org_role(p.organization_id, ARRAY[
          'ADMIN'::public.organization_role,
          'VIEWER'::public.organization_role,
      'AGENT'::public.organization_role,
      'MANAGER'::public.organization_role
        ])
    )
  );

create policy "project_execution_targets_insert_project_admin"
  on public.project_execution_targets for insert to authenticated
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = project_id
        and p.organization_id = organization_id
        and public.has_org_role(p.organization_id, ARRAY['ADMIN'::public.organization_role])
    )
  );

create policy "project_execution_targets_update_project_admin"
  on public.project_execution_targets for update to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_id
        and public.has_org_role(p.organization_id, ARRAY['ADMIN'::public.organization_role])
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      where p.id = project_id
        and p.organization_id = organization_id
        and public.has_org_role(p.organization_id, ARRAY['ADMIN'::public.organization_role])
    )
  );

create policy "project_execution_targets_delete_project_admin"
  on public.project_execution_targets for delete to authenticated
  using (
    exists (
      select 1
      from public.projects p
      where p.id = project_id
        and public.has_org_role(p.organization_id, ARRAY['ADMIN'::public.organization_role])
    )
  );
