-- Allow multiple Overlord projects to map to the same Everhour project.
--
-- Previously `projects_org_everhour_project_id_key` enforced a UNIQUE mapping of
-- (organization_id, everhour_project_id), so only one Overlord project per
-- organization could link to a given Everhour project. Replacing it with a
-- non-unique index keeps the lookup fast while letting several Overlord projects
-- share a single Everhour project ID.
drop index if exists public.projects_org_everhour_project_id_key;

create index if not exists projects_org_everhour_project_id_idx
  on public.projects using btree (organization_id, everhour_project_id)
  where (everhour_project_id is not null);
