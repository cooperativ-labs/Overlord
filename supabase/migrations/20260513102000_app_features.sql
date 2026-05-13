create table app_features (
  key text primary key,
  name text not null,
  description text not null,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table app_features enable row level security;

insert into app_features (key, name, description, is_enabled)
values (
  'ssh',
  'SSH remote workspaces',
  'Shows SSH configuration and remote workspace selection throughout the web and desktop apps.',
  true
)
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description;
