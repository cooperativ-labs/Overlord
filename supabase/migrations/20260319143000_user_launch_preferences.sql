-- Per-user launch preferences for the next ticket the user starts.
create table user_launch_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_type text not null,
  model_id text,
  thinking text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_id)
);

alter table user_launch_preferences enable row level security;

create policy "Users can read own launch preferences"
  on user_launch_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert own launch preferences"
  on user_launch_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own launch preferences"
  on user_launch_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own launch preferences"
  on user_launch_preferences for delete
  using (auth.uid() = user_id);

create index user_launch_preferences_user_id_idx
  on user_launch_preferences(user_id);
