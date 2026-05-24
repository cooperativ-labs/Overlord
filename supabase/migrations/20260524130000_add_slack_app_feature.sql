insert into app_features (key, name, description, is_enabled)
values (
  'slack',
  'Slack integration',
  'Shows Slack workspace connection settings and per-project Slack configuration throughout the app.',
  false
)
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description,
  is_enabled = excluded.is_enabled;
