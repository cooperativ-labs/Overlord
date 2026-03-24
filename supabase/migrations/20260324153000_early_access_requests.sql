create table public.early_access_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  role text not null,
  created_at timestamptz not null default now()
);

alter table public.early_access_requests enable row level security;

create policy "early_access_requests_insert_public"
  on public.early_access_requests
  for insert
  to anon, authenticated
  with check (true);

create policy "early_access_requests_select_admin"
  on public.early_access_requests
  for select
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  );

create policy "early_access_requests_update_admin"
  on public.early_access_requests
  for update
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  )
  with check (
    auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  );

create policy "early_access_requests_delete_admin"
  on public.early_access_requests
  for delete
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  );
