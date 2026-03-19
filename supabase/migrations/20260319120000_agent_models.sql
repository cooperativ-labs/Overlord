-- Agent models: stores available models per agent provider with thinking options
create table agent_models (
  id uuid primary key default gen_random_uuid(),
  agent_type text not null,
  model_id text not null,
  display_name text not null,
  thinking_options jsonb default '[]'::jsonb,
  capabilities jsonb default '{}'::jsonb,
  is_recommended boolean default false,
  sort_order int default 0,
  updated_at timestamptz default now(),
  unique(agent_type, model_id)
);

alter table agent_models enable row level security;

create policy "Anyone can read agent models"
  on agent_models for select
  using (true);

-- Only service role can insert/update/delete (via edge function)
-- No insert/update/delete policies for authenticated users
