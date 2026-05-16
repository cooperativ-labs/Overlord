-- Add logo_url to organizations
alter table public.organizations
  add column if not exists logo_url text;

-- Public org-images bucket for organization logos
insert into storage.buckets (id, name, public, file_size_limit)
values ('org-images', 'org-images', true, 5242880)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "Public read org images" on storage.objects;
drop policy if exists "Org members can upload org images" on storage.objects;
drop policy if exists "Org members can update org images" on storage.objects;
drop policy if exists "Org members can delete org images" on storage.objects;

create policy "Public read org images"
  on storage.objects
  for select
  to public
  using (bucket_id = 'org-images');

-- Path convention: org-images/<org_id>/...
-- Only org members can upload/update/delete

create policy "Org members can upload org images"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'org-images'
    and public.is_org_member(split_part(name, '/', 1)::int)
  );

create policy "Org members can update org images"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'org-images'
    and public.is_org_member(split_part(name, '/', 1)::int)
  )
  with check (
    bucket_id = 'org-images'
    and public.is_org_member(split_part(name, '/', 1)::int)
  );

create policy "Org members can delete org images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'org-images'
    and public.is_org_member(split_part(name, '/', 1)::int)
  );
