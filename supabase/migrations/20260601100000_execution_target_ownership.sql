-- Target ownership lives on the org↔target join, not on execution_targets, so a
-- target shared across orgs can be personal in one org and organization-owned in
-- another (my laptop is "mine" in both my orgs; a shared server is org-owned).
--
--   owner_user_id set  -> personal target: only the owner may manage directories
--                         / set the primary for any project on it (in that org).
--   owner_user_id null -> organization-owned target: any user with project edit
--                         permission (ADMIN/MANAGER) may manage directories.

alter table public.organization_execution_targets
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

comment on column public.organization_execution_targets.owner_user_id is
  'Per-org owner of this target. When set, only the owner may manage resource directories / primaries for projects on this target in this org. When null, the target is organization-owned and any project editor (ADMIN/MANAGER) may manage them.';

create index if not exists organization_execution_targets_owner_idx
  on public.organization_execution_targets (owner_user_id)
  where owner_user_id is not null;
