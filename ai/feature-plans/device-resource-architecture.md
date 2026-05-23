# Execution Target And Resource Architecture

## Scope

This note reviews the current overlap between `devices`, `servers`, `project_user`, and `project_resource_directories`, then proposes a cleaner schema for SSH/execution targeting. The target domain term should be `execution_target`, not `device`, because the thing agents execute on may be a laptop, SSH server, VM, container, devbox, codespace, or future hosted runner.

## Requirement Review

The requirements mostly make sense, with one important correction: an execution target cannot be both globally unique and directly owned by one `(organization, user)` row. The canonical execution target identity needs to be independent from organization/user association rows.

Confirmed requirements:

- A device/server should be modeled as an execution target with host, port, label, and fingerprint.
- A physical or remote execution target can be visible to multiple organizations and users.
- Organization-local execution target labels should be unique inside an organization so humans and agents can refer to `builder-mac` instead of a UUID or fingerprint. The same target may have different labels in different organizations, and different organizations may reuse the same label.
- Resource directories should be the authority for project paths, and every resource should point at exactly one execution target.
- Placeholder devices are needed when a user knows the SSH host/path before the remote machine has registered with `ovld`.
- SSH keys are per user and per execution target. Overlord stores references/metadata only, not generated private keys.
- Adding an execution target to a project should also associate it with the project organization.
- The first version should remove the legacy mobile `servers` table and temporarily remove that mobile functionality. Mobile can migrate to execution targets later.

Resolved design decisions:

- Canonical identity uses a real `device_fingerprint` when known. Before registration, use a placeholder key like `ssh:{host}:{port}` only until reconciliation.
- Do not enforce global uniqueness on host/port. Host and port are connection coordinates, not canonical identity.
- Separate organization labels from target identity. The same target can be called `buildbox` in one org and `linux-ci` in another, and two organizations can both have a `buildbox`.
- Track user access separately from organization visibility. Organization association does not imply every member has SSH credentials.
- The primary folder is project-specific and execution-target-specific, not user-specific. If two users operate on the same project on the same target, they should treat the same resource as primary.
- Private key paths are local hints and should not be treated as portable server-side secret truth.

## Current Table And App Map

### `devices`

Created by `supabase/migrations/20260516100000_add_devices_table.sql` and extended by `20260523120000_per_device_primary_resource.sql`.

Current shape:

- `organization_id`
- `user_id`
- `device_fingerprint`
- `label`
- `hostname`
- `platform`
- `last_seen_at`
- `is_placeholder`
- unique `(organization_id, user_id, device_fingerprint)`
- unique `(organization_id, label)`

Current consumers:

- Protocol routes register/update/read devices through `lib/overlord/upsert-device.ts`, `apps/web/app/api/protocol/get-device/route.ts`, and `apps/web/app/api/protocol/update-device/route.ts`.
- Resource APIs register device-scoped paths through `add-project-resource`, `update-project-resource`, and `list-project-resources`.
- Desktop/web resource UI reads device labels through `lib/actions/resource-directories.ts`.

Problem:

- The current table represents a user's association to a device, not the canonical device. The unique key allows duplicate rows for the same physical device across users and organizations.

### `servers`

Created by `supabase/migrations/20260403180000_servers_table.sql`.

Current shape:

- `user_id`
- `organization_id`
- `label`
- `host`
- `port`
- `username`
- SSH key/status columns, with later mobile-facing fields visible in app types such as `transport`, `host_key_fingerprint`, `last_verified_at`, and `last_error`.

Current consumers:

- Mobile server list and realtime subscription in `apps/mobile/lib/server-connections-context.tsx`.
- Mobile add/detail/launch flows in `apps/mobile/app/(tabs)/account/servers/*` and ticket detail screens.

Problem:

- It duplicates device identity and connection data while remaining user-owned. It should be folded into the device/access model after desktop/web is migrated.

### `project_user`

Started as project preferences in `20260312090000_project_user_preferences.sql`, then became SSH/local settings in `20260421113000_move_ssh_settings_to_project_user_preferences.sql` and `20260421191500_move_project_user_fields_and_add_created_by.sql`.

Current shape relevant to this ticket:

- `preferences`
- `local_working_directory`
- `remote_working_directory`
- `ssh_command`
- `ssh_host`
- `ssh_port`
- `ssh_user`
- `ssh_auth_method`
- `ssh_private_key_path`
- helper install/version timestamps

Current consumers:

- Web project lists/settings use `lib/actions/projects.ts`, `lib/actions/project-selects.ts`, and `lib/actions/project-types.ts`.
- `SshWorkspaceSection` edits SSH config into `project_user`.
- Legacy fallback project resolution still checks `project_user.local_working_directory`.
- Quick run/project modal still expose `remote_working_directory`.

Problem:

- It mixes user/project preferences with execution topology. It duplicates local and remote paths that should live in resource directories, and it stores SSH connection details that should be modeled as user access to a device.

### `project_resource_directories`

Created by `20260516110000_add_project_resource_directories.sql`.

Current shape:

- `project_id`
- `user_id`
- `device_id`
- `directory_path`
- `label`
- `is_primary`

Current consumers:

- Desktop resource management UI in `ResourceDirectoryList`.
- Execution selector in `ProjectExecutionWorkspaceSelector`.
- Protocol add/update/list resource routes.
- Project discovery/resolution in `lib/overlord/resolve-project.ts`, `lib/overlord/resolve-project-user.ts`, and MCP mirrors.
- Execution claiming in `apps/web/app/api/protocol/claim-execution/route.ts`.

Problem:

- It is the right path authority, but it references the current per-user/per-org `devices` table. It also has inconsistent "primary" semantics in web server actions: some paths clear primary by project, while protocol routes clear by device.

## Proposed Architecture

Use `execution_targets` as the canonical execution target table and remove `servers`. Keep `project_user` for project preferences only.

### Canonical Tables

#### `execution_targets`

One row per actual or placeholder execution target.

Recommended columns:

- `id uuid primary key`
- `device_fingerprint text null`
- `placeholder_key text null`
- `is_placeholder boolean not null default false`
- `host text not null`
- `port integer not null default 22`
- `name text null`
- `transport text not null default 'ssh'`
- `platform text null`
- `last_seen_at timestamptz null`
- timestamps

Recommended constraints:

- `check ((is_placeholder and placeholder_key is not null) or (not is_placeholder and device_fingerprint is not null))`
- unique `device_fingerprint` where `device_fingerprint is not null`
- unique `placeholder_key` where `placeholder_key is not null`

Do not include `organization_id` or `user_id` on this table.

VM/container note:

- Two VMs on the same physical machine are two execution targets if agents execute inside each VM. Each VM should register its own real `device_fingerprint`; shared host hardware does not collapse them into one row.

#### `organization_execution_targets`

Organization-specific visibility and naming.

Recommended columns:

- `organization_id`
- `execution_target_id`
- `label`
- `added_by`
- timestamps

Recommended constraints:

- primary key `(organization_id, execution_target_id)`
- unique `(organization_id, label)`

This satisfies "labels unique within organizations" without duplicating execution targets.

#### `user_execution_targets`

User-specific access to an execution target.

Recommended columns:

- `user_id`
- `execution_target_id`
- `default_username text null`
- `access_status text`
- `last_connected_at`
- timestamps

Recommended constraints:

- primary key `(user_id, execution_target_id)`

This models "this user can use this execution target" independently of organization membership.

#### `execution_target_ssh_credentials`

Per-user SSH key reference for an execution target. No private key material.

Recommended columns:

- `id uuid primary key`
- `execution_target_id`
- `user_id`
- `username`
- `auth_method text`
- `private_key_path text null`
- `public_key_fingerprint text null`
- `host_key_fingerprint text null`
- `secure_enclave_tag text null`
- `created_at`
- `updated_at`

Recommended constraints:

- unique `(execution_target_id, user_id, username, auth_method)`

For desktop/web v1, `private_key_path` is just a client-local hint. For mobile later, `secure_enclave_tag` can replace the old local credential metadata tied to `servers`.

Keep this separate from `user_execution_targets` because access and authentication have different lifecycles. A user can have access before credentials are configured, can rotate keys without losing access, and may eventually have multiple auth methods/usernames for the same target.

#### `project_execution_targets`

Which execution targets are available for a project.

Recommended columns:

- `project_id`
- `execution_target_id`
- `organization_id`
- `added_by`
- timestamps

Recommended constraints:

- primary key `(project_id, execution_target_id)`
- foreign key `(organization_id, execution_target_id)` through `organization_execution_targets` or a trigger that ensures the target belongs to the project organization.

Adding an execution target to a project should transactionally upsert `execution_targets`, `organization_execution_targets`, `user_execution_targets`, and `project_execution_targets`.

#### `project_resource_directories`

Keep this as the path authority, but make device association required.

Recommended columns:

- `project_id`
- `execution_target_id not null`
- `directory_path`
- `label`
- `is_primary`
- timestamps

Recommended constraints:

- unique `(project_id, execution_target_id, directory_path)`
- unique `(project_id, execution_target_id) where is_primary`

The primary resource is shared per `(project, execution_target)`. This means two users operating on the same project on the same target see the same primary resource. User-specific SSH credentials still control how each user logs in, but the project path on that target is shared project topology.

### What To Delete From `project_user`

Remove these once callers are migrated:

- `local_working_directory`
- `remote_working_directory`
- `ssh_command`
- `ssh_host`
- `ssh_port`
- `ssh_user`
- `ssh_auth_method`
- `ssh_private_key_path`
- remote helper install/version fields if they describe a device rather than a project preference

Keep:

- `preferences`
- any actual per-user/project UI state

### Placeholder Reconciliation

When saving an SSH target before remote registration:

1. Upsert `execution_targets` with `is_placeholder=true`, `placeholder_key='ssh:{host}:{port}'`, `host`, and `port`.
2. Upsert `organization_execution_targets`, `user_execution_targets`, `execution_target_ssh_credentials`, and `project_execution_targets`.
3. Upsert `project_resource_directories` for `(project, placeholder execution target, remote path)`.

When `ovld` runs on the remote:

1. It calls `get-device` with a real fingerprint, host, and port.
2. Server looks for an exact placeholder by host/port and project/org/user context.
3. If found, update that `execution_targets` row with `device_fingerprint`, `is_placeholder=false`, and clear `placeholder_key`.
4. Existing resources and project/target associations stay attached to the same `execution_target_id`.

Avoid creating a second real device row and later merging if possible.

### API/UI Changes

Web/desktop:

- Replace `SshWorkspaceSection` writes to `project_user` with a "Project execution targets" flow that writes target, credential, project-target, and resource rows.
- Replace `remoteWorkingDirectory` reads from `project_user` with the primary resource for the selected execution target.
- Update `ProjectExecutionWorkspaceSelector` and `ResourceDirectoryList` to use one primary per `(project, execution_target)` consistently.
- Remove legacy `project_user` fallbacks from `resolve-project`, `resolve-project-user`, `discover-project`, `claim-execution`, and protocol docs once migration is complete.

Protocol/CLI:

- `get-device` should become `get-execution-target` at the API/domain layer, while CLI aliases can preserve user-friendly wording during transition.
- Target registration should upsert canonical `execution_targets`, then ensure user/org association rows.
- `add-project-resource` should require execution target identity and write `project_execution_targets` if missing.
- `list-project-resources` should filter by canonical `execution_target_id` and project.
- `claim-execution` should resolve by `target_resource_id` first, then primary resource for `(project, execution_target)`.
- `add-cwd` remains correct conceptually: it registers current cwd as a resource for the current canonical execution target and project.

Mobile:

- Drop the current `servers`-backed mobile server functionality in this change instead of preserving legacy support.
- Later, migrate mobile to `execution_targets`, `user_execution_targets`, and `execution_target_ssh_credentials`.
- Keep mobile-specific connection status on `user_execution_targets` or a dedicated connection-status table, not canonical `execution_targets`.

## Migration Plan

1. Add new canonical tables and constraints.
2. Build a small service layer for execution target upsert, placeholder upsert, and reconciliation.
3. Migrate desktop/web SSH settings:
   - Create canonical execution target rows from non-null `project_user.ssh_host`.
   - Create credential rows from `ssh_user`, `ssh_auth_method`, `ssh_private_key_path`.
   - Create project-target rows.
   - Create resource rows from `remote_working_directory`.
   - Create local execution target resource rows from `local_working_directory` where current target identity is known; otherwise leave those to `add-cwd`.
4. Update server actions and protocol routes to new tables.
5. Remove `project_user` SSH/path columns and legacy fallbacks.
6. Remove `servers` and the mobile screens/actions that depend on it. Mobile SSH/server functionality returns later on the execution-target model.

## Key Decision

The primary resource decision is now settled: resource primary status is shared per `(project_id, execution_target_id)`, not per user. SSH credentials remain user-specific, but project topology on a target is project-level.
