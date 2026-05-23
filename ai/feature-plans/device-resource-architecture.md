# Device And Resource Architecture

## Scope

This note reviews the current overlap between `devices`, `servers`, `project_user`, and `project_resource_directories`, then proposes a cleaner schema for SSH/execution targeting. It intentionally ignores mobile implementation details for the first version, but calls out the later mobile migration because mobile is currently the main `servers` consumer.

## Requirement Review

The requirements mostly make sense, with one important correction: a device cannot be both globally unique and directly owned by one `(organization, user)` row. The canonical device identity needs to be independent from organization/user association rows.

Confirmed requirements:

- A device/server is an execution target with host, port, label, and fingerprint.
- A physical or remote execution target can be visible to multiple organizations and users.
- Device labels should be unique inside an organization so humans and agents can refer to `builder-mac` instead of a UUID or fingerprint.
- Resource directories should be the authority for project paths, and every resource should point at exactly one device.
- Placeholder devices are needed when a user knows the SSH host/path before the remote machine has registered with `ovld`.
- SSH keys are per user and per device. Overlord stores references/metadata only, not generated private keys.
- Adding a device to a project should also associate it with the project organization.
- First version can ignore mobile and delete legacy SSH configuration.

Missing or ambiguous requirements to resolve before implementation:

- Define canonical identity. Host + port alone is not enough across NAT, reused IPs, dynamic DNS, and SSH aliases. Use a real `device_fingerprint` when known; use a placeholder key like `ssh:{host}:{port}` only until reconciliation.
- Decide whether host uniqueness is global. The requirement says one host and one port per device, but not that `(host, port)` uniquely identifies a device globally. I would not enforce global uniqueness on host/port.
- Separate organization labels from device identity. The same device may be called `buildbox` in one org and `linux-ci` in another.
- Track user access to a device separately from organization visibility. Organization association does not imply every member has SSH credentials.
- Decide whether "primary folder" is per `(project, device)` or per `(user, project, device)`. The product language points to per-device/project execution, but user-specific paths can differ on the same host. I recommend user-scoped resources for v1.
- Clarify secret handling. Private key paths are local to the initiating client and should not be treated as portable server-side truth.

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

Use `devices` as the canonical execution target and remove `servers` from desktop/web. Keep `project_user` for project preferences only.

### Canonical Tables

#### `devices`

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

#### `organization_devices`

Organization-specific visibility and naming.

Recommended columns:

- `organization_id`
- `device_id`
- `label`
- `added_by`
- timestamps

Recommended constraints:

- primary key `(organization_id, device_id)`
- unique `(organization_id, label)`

This satisfies "labels unique within organizations" without duplicating devices.

#### `user_devices`

User-specific access to a device.

Recommended columns:

- `user_id`
- `device_id`
- `default_username text null`
- `access_status text`
- `last_connected_at`
- timestamps

Recommended constraints:

- primary key `(user_id, device_id)`

This models "this user can use this device" independently of organization membership.

#### `device_ssh_credentials`

Per-user SSH key reference for a device. No private key material.

Recommended columns:

- `id uuid primary key`
- `device_id`
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

- unique `(device_id, user_id, username, auth_method)`

For desktop/web v1, `private_key_path` is just a client-local hint. For mobile later, `secure_enclave_tag` can replace the old local credential metadata tied to `servers`.

#### `project_devices`

Which devices are available for a project.

Recommended columns:

- `project_id`
- `device_id`
- `organization_id`
- `added_by`
- timestamps

Recommended constraints:

- primary key `(project_id, device_id)`
- foreign key `(organization_id, device_id)` through `organization_devices` or a trigger that ensures the device belongs to the project organization.

Adding a device to a project should transactionally upsert `devices`, `organization_devices`, `user_devices`, and `project_devices`.

#### `project_resource_directories`

Keep this as the path authority, but make device association required.

Recommended columns:

- `project_id`
- `device_id not null`
- `user_id not null`
- `directory_path`
- `label`
- `is_primary`
- timestamps

Recommended constraints:

- unique `(project_id, device_id, user_id, directory_path)`
- unique `(project_id, device_id, user_id) where is_primary`

I recommend primary per `(project, device, user)` for v1. It lets two users SSH into the same host with different home directories without clobbering each other. If the desired product behavior is truly one shared path per project/device, drop `user_id` from the primary uniqueness and make resources organization-owned instead.

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

1. Upsert `devices` with `is_placeholder=true`, `placeholder_key='ssh:{host}:{port}'`, `host`, and `port`.
2. Upsert `organization_devices`, `user_devices`, `device_ssh_credentials`, and `project_devices`.
3. Upsert `project_resource_directories` for `(project, placeholder device, user, remote path)`.

When `ovld` runs on the remote:

1. It calls `get-device` with a real fingerprint, host, and port.
2. Server looks for an exact placeholder by host/port and project/org/user context.
3. If found, update that `devices` row with `device_fingerprint`, `is_placeholder=false`, and clear `placeholder_key`.
4. Existing resources and project/device associations stay attached to the same `device_id`.

Avoid creating a second real device row and later merging if possible.

### API/UI Changes

Web/desktop:

- Replace `SshWorkspaceSection` writes to `project_user` with a "Project devices" flow that writes device, credential, project-device, and resource rows.
- Replace `remoteWorkingDirectory` reads from `project_user` with the primary resource for the selected device.
- Update `ProjectExecutionWorkspaceSelector` and `ResourceDirectoryList` to use one primary per `(project, device, user)` consistently.
- Remove legacy `project_user` fallbacks from `resolve-project`, `resolve-project-user`, `discover-project`, `claim-execution`, and protocol docs once migration is complete.

Protocol/CLI:

- `get-device` should upsert canonical `devices`, then ensure user/org association rows.
- `add-project-resource` should require device identity and write `project_devices` if missing.
- `list-project-resources` should filter by canonical `device_id` and project.
- `claim-execution` should resolve by `target_resource_id` first, then primary resource for `(project, device, user)`.
- `add-cwd` remains correct conceptually: it registers current cwd as a resource for the current canonical device and project.

Mobile later:

- Replace `servers` with `devices`, `user_devices`, and `device_ssh_credentials`.
- Migrate mobile secure-enclave key metadata from server-local storage to credential IDs or `(device_id, user_id)`.
- Keep mobile-specific connection status on `user_devices` or a `device_connection_status` table, not canonical `devices`.

## Migration Plan

1. Add new canonical tables and constraints.
2. Build a small service layer for device upsert, placeholder upsert, and reconciliation.
3. Migrate desktop/web SSH settings:
   - Create canonical device rows from non-null `project_user.ssh_host`.
   - Create credential rows from `ssh_user`, `ssh_auth_method`, `ssh_private_key_path`.
   - Create project-device rows.
   - Create resource rows from `remote_working_directory`.
   - Create local device resource rows from `local_working_directory` where current device identity is known; otherwise leave those to `add-cwd`.
4. Update server actions and protocol routes to new tables.
5. Remove `project_user` SSH/path columns and legacy fallbacks.
6. Leave `servers` in place only for mobile until mobile is migrated; do not use it for desktop/web v1.
7. In a later mobile migration, backfill `servers` into canonical devices and credentials, then drop `servers`.

## Key Decision

The main design decision is whether resources are user-scoped or organization-scoped. Given "SSH keys are each associated with one device and one user" and users may log into the same device as different Unix users, v1 should keep `project_resource_directories.user_id` and enforce primary per `(project_id, device_id, user_id)`.
