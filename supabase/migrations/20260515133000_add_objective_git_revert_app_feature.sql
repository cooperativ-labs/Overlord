insert into app_features (key, name, description, is_enabled)
values (
  'objective-git-revert',
  'Objective git revert',
  'Shows per-objective checkpoint revert controls and local checkpoint cleanup actions.',
  false
)
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description,
  is_enabled = excluded.is_enabled;
