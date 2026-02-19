alter table public.tickets
  add column if not exists everhour_task_id text,
  add column if not exists everhour_project_id text;

create table if not exists public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  api_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_integrations_user_provider_key unique (user_id, provider)
);

create index if not exists user_integrations_user_id_idx on public.user_integrations (user_id);

alter table public.user_integrations enable row level security;

grant select, insert, update, delete on table public.user_integrations to authenticated;
grant select, insert, update, delete on table public.user_integrations to service_role;

drop policy if exists "user_integrations_select_own" on public.user_integrations;
drop policy if exists "user_integrations_insert_own" on public.user_integrations;
drop policy if exists "user_integrations_update_own" on public.user_integrations;
drop policy if exists "user_integrations_delete_own" on public.user_integrations;

create policy "user_integrations_select_own"
on public.user_integrations
as permissive
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "user_integrations_insert_own"
on public.user_integrations
as permissive
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "user_integrations_update_own"
on public.user_integrations
as permissive
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "user_integrations_delete_own"
on public.user_integrations
as permissive
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop trigger if exists set_user_integrations_updated_at on public.user_integrations;
create trigger set_user_integrations_updated_at
before update on public.user_integrations
for each row execute function public.set_updated_at();
