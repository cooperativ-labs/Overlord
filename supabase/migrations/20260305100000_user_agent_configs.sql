-- User agent configurations (flags, model preferences, permissions)
create table user_agent_configs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_type text not null,
  config jsonb not null default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_id, agent_type)
);

alter table user_agent_configs enable row level security;

create policy "Users can read own configs"
  on user_agent_configs for select
  using (auth.uid() = user_id);

create policy "Users can update own configs"
  on user_agent_configs for update
  using (auth.uid() = user_id);

create policy "Users can insert own configs"
  on user_agent_configs for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own configs"
  on user_agent_configs for delete
  using (auth.uid() = user_id);

create index user_agent_configs_user_id_idx on user_agent_configs(user_id);
create index user_agent_configs_agent_type_idx on user_agent_configs(user_id, agent_type);
