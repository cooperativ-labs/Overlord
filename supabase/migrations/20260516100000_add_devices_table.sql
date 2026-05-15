-- Device identity for protocol callers (CLI / MCP / desktop).
-- Each device is registered per (organization, user, device_fingerprint) and
-- carries a human-readable, org-unique kebab-case `label` used in UI, CLI flags,
-- and logs.
create table public.devices (
  id uuid default gen_random_uuid() primary key,
  organization_id integer not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_fingerprint text not null,
  label text not null,
  hostname text,
  platform text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, device_fingerprint),
  unique (organization_id, label),
  constraint devices_label_format check (label ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$')
);

create index devices_user_id_idx on public.devices(user_id);
create index devices_org_idx on public.devices(organization_id);

alter table public.devices enable row level security;

create policy "devices_select_self_or_org_admin"
  on public.devices for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_org_role(organization_id, ARRAY['ADMIN'::public.organization_role])
  );

create policy "devices_insert_self"
  on public.devices for insert to authenticated
  with check (user_id = auth.uid());

create policy "devices_update_self"
  on public.devices for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "devices_delete_self"
  on public.devices for delete to authenticated
  using (user_id = auth.uid());

-- Sanitize hostname/platform into a kebab-case candidate label.
create or replace function public.sanitize_device_label_candidate(
  raw text
) returns text language plpgsql immutable as $$
declare
  candidate text;
begin
  if raw is null or length(trim(raw)) = 0 then
    return null;
  end if;
  candidate := lower(raw);
  -- Replace any run of non-alphanumeric chars with a single hyphen.
  candidate := regexp_replace(candidate, '[^a-z0-9]+', '-', 'g');
  -- Trim leading/trailing hyphens.
  candidate := regexp_replace(candidate, '^-+|-+$', '', 'g');
  if length(candidate) = 0 then
    return null;
  end if;
  if length(candidate) > 64 then
    candidate := substring(candidate from 1 for 64);
    candidate := regexp_replace(candidate, '-+$', '', 'g');
  end if;
  return candidate;
end;
$$;

-- Generate a unique device label for the given organization.
create or replace function public.generate_device_label(
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
      base := base || '-device';
    end if;
  end if;
  if base is null then
    base := 'device';
  end if;

  candidate := base;
  while exists (
    select 1 from public.devices where organization_id = org_id and label = candidate
  ) loop
    candidate := base || '-' || suffix::text;
    suffix := suffix + 1;
  end loop;
  return candidate;
end;
$$;

create or replace function public.touch_devices_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.touch_devices_updated_at();
