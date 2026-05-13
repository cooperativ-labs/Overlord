insert into app_features (key, name, description, is_enabled)
values (
  'future-objectives',
  'Future objectives',
  'Shows multi-objective planning with future objective placeholders and promotion controls.',
  false
)
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description,
  is_enabled = excluded.is_enabled;
