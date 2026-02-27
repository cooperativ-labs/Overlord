-- Create the "artifacts" storage bucket for ticket document/image uploads.
-- File structure: /<organization_id>/<project_id>/<ticket_id>/<filename>
insert into storage.buckets (id, name, public, file_size_limit)
values ('artifacts', 'artifacts', false, 52428800)
on conflict (id) do nothing;

-- Helper: given a storage object name that follows the convention
--   <organization_id>/<project_id>/<ticket_id>/...
-- extract the organization_id (first path segment) as an integer.
create or replace function public.storage_org_id(object_name text)
returns integer
language sql
immutable
as $$
  select nullif(split_part(object_name, '/', 1), '')::integer;
$$;

-- Helper: extract ticket_id (third path segment) from storage object name.
create or replace function public.storage_ticket_id(object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(object_name, '/', 3), '')::uuid;
$$;

-- RLS mirrors the associated ticket's permissions:
-- SELECT: org members can view (same as tickets_select_member)
create policy "Artifacts bucket select for org members"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'artifacts'
    and public.is_org_member(public.storage_org_id(name))
  );

-- INSERT: agent+ roles can upload (same as tickets_insert_agent_plus)
create policy "Artifacts bucket insert for agent+"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'artifacts'
    and public.has_org_role(
      public.storage_org_id(name),
      ARRAY['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
    )
  );

-- UPDATE: agent+ roles can update (same as tickets_update_agent_plus)
create policy "Artifacts bucket update for agent+"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'artifacts'
    and public.has_org_role(
      public.storage_org_id(name),
      ARRAY['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
    )
  )
  with check (
    bucket_id = 'artifacts'
    and public.has_org_role(
      public.storage_org_id(name),
      ARRAY['AGENT'::public.organization_role, 'MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
    )
  );

-- DELETE: manager+ roles can delete (same as tickets_delete_manager_plus)
create policy "Artifacts bucket delete for manager+"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'artifacts'
    and public.has_org_role(
      public.storage_org_id(name),
      ARRAY['MANAGER'::public.organization_role, 'ADMIN'::public.organization_role]
    )
  );

-- Add a "document" artifact_type alongside the existing "image" type.
-- Also add storage_path column to artifacts table for Supabase Storage references.
alter table public.artifacts
  add column if not exists storage_path text,
  add column if not exists uploaded_by uuid references auth.users(id);
