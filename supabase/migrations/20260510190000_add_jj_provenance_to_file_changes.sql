alter table "public"."file_changes"
  add column if not exists "snapshot_backend" text,
  add column if not exists "workspace_name" text,
  add column if not exists "workspace_path" text,
  add column if not exists "jj_change_id" text,
  add column if not exists "jj_commit_id" text,
  add column if not exists "jj_operation_id" text;
