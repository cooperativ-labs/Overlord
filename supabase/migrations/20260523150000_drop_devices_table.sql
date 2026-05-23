-- Drop the legacy `devices` table now that `execution_targets` (and its
-- org/user/project association tables, added in 20260523133000) is the sole
-- source of truth for execution target identity.
--
-- Order matters: legacy FK columns must be removed before the referenced
-- table can be dropped. The `*_execution_target_id` columns were backfilled
-- by 20260523133000 and have been in use since.

-- 1. Drop legacy FK columns on execution_requests.
drop index if exists public.execution_requests_claimed_device_idx;

alter table public.execution_requests
  drop column if exists target_device_id,
  drop column if exists claimed_by_device_id;

-- 2. Drop legacy FK column on project_resource_directories. The partial
--    unique index on (user_id, device_id, directory_path) is now superseded
--    by project_resource_directories_primary_target_uidx.
drop index if exists public.project_resource_directories_device_idx;
drop index if exists public.project_resource_directories_one_primary_per_device_idx;

alter table public.project_resource_directories
  drop column if exists device_id;

-- 3. Drop the orphaned label generator. `sanitize_device_label_candidate` is
--    intentionally kept — `generate_execution_target_label` still depends on
--    it.
drop function if exists public.generate_device_label(integer, text, text);

-- 4. Drop the devices table itself. CASCADE removes the attached trigger and
--    RLS policies in one shot.
drop table if exists public.devices cascade;

drop function if exists public.touch_devices_updated_at();
