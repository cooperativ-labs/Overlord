drop index if exists public.project_tag_definitions_project_id_label_key;

create unique index project_tag_definitions_project_id_label_key
  on public.project_tag_definitions using btree (project_id, lower(btrim(label)));
