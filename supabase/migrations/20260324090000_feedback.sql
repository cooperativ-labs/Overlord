-- Feedback table: stores user feedback submissions
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  description text not null,
  screenshot_paths text[] default '{}',
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.feedback enable row level security;

-- Any authenticated user can insert their own feedback
create policy "feedback_insert_authenticated"
  on public.feedback
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Only jake@cooperativ.io can select, update, delete
create policy "feedback_select_admin"
  on public.feedback
  for select
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  );

create policy "feedback_update_admin"
  on public.feedback
  for update
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  )
  with check (
    auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  );

create policy "feedback_delete_admin"
  on public.feedback
  for delete
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  );

-- Storage bucket for feedback screenshots
insert into storage.buckets (id, name, public, file_size_limit)
values ('feedback-screenshots', 'feedback-screenshots', false, 10485760)
on conflict (id) do nothing;

-- Any authenticated user can upload screenshots
create policy "Feedback screenshots insert for authenticated"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'feedback-screenshots'
  );

-- Only jake@cooperativ.io can view/manage screenshots
create policy "Feedback screenshots select for admin"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'feedback-screenshots'
    and auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  );

create policy "Feedback screenshots update for admin"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'feedback-screenshots'
    and auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  )
  with check (
    bucket_id = 'feedback-screenshots'
    and auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  );

create policy "Feedback screenshots delete for admin"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'feedback-screenshots'
    and auth.jwt() ->> 'email' = 'jake@cooperativ.io'
  );
