-- Per-device primary resource semantics + placeholder device support.
--
-- Two changes:
--   1. `devices.is_placeholder` flags rows created from SSH config saves where
--      the device fingerprint is a derived stub (e.g. `ssh:user@host:port`)
--      because the remote machine has not yet registered itself by running
--      `ovld`. When the real device registers, reconciliation can update or
--      replace the placeholder.
--   2. Enforce at most one primary resource per (user, device) via a partial
--      unique index, so every device has a single, well-defined primary
--      directory it operates out of.

alter table public.devices
  add column if not exists is_placeholder boolean not null default false;

comment on column public.devices.is_placeholder is
  'True when this device row was created from an SSH config save (fingerprint derived from host) rather than from an `ovld` process registering itself. Reconciliation may later merge a placeholder with the real device.';

-- One primary resource per (user, device). device_id may be null for legacy
-- resources, so the index is partial.
create unique index if not exists project_resource_directories_one_primary_per_device_idx
  on public.project_resource_directories (user_id, device_id, directory_path)
  where is_primary;
