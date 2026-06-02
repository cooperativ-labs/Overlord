-- Complication #2 fix: the ownership column (20260601100000) was added with no
-- backfill, so every pre-existing org↔target association defaulted to
-- owner_user_id = NULL (organization-owned). The intended default is that a
-- target is owned by the user who added it. Backfill legacy associations from
-- `added_by` so existing personal machines stop silently reading as org-owned.
update public.organization_execution_targets
  set owner_user_id = added_by
  where owner_user_id is null
    and added_by is not null;
