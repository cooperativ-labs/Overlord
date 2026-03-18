-- Public avatar storage with owner-scoped writes under /<user_id>/...
insert into storage.buckets (id, name, public, file_size_limit)
values ('user-images', 'user-images', true, 5242880)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "Public read user images" on storage.objects;
drop policy if exists "Users can upload their own images" on storage.objects;
drop policy if exists "Users can update their own images" on storage.objects;
drop policy if exists "Users can delete their own images" on storage.objects;

create policy "Public read user images"
  on storage.objects
  for select
  to public
  using (bucket_id = 'user-images');

create policy "Users can upload their own images"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'user-images'
    and split_part(name, '/', 1) = ((select auth.uid())::text)
  );

create policy "Users can update their own images"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'user-images'
    and split_part(name, '/', 1) = ((select auth.uid())::text)
  )
  with check (
    bucket_id = 'user-images'
    and split_part(name, '/', 1) = ((select auth.uid())::text)
  );

create policy "Users can delete their own images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'user-images'
    and split_part(name, '/', 1) = ((select auth.uid())::text)
  );
