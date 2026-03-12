-- Per-user, per-project UI preferences (hidden columns, preferred view, etc.)
create table project_user_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  preferences jsonb not null default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_id, project_id)
);

alter table project_user_preferences enable row level security;

create policy "Users can read own project preferences"
  on project_user_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert own project preferences"
  on project_user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own project preferences"
  on project_user_preferences for update
  using (auth.uid() = user_id);

create policy "Users can delete own project preferences"
  on project_user_preferences for delete
  using (auth.uid() = user_id);

create index project_user_preferences_user_project_idx
  on project_user_preferences(user_id, project_id);
