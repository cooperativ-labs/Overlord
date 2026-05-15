# Engineering Plan: Flexible Resource Directories

**Ticket:** 1:1067  
**Status:** Planning  
**Date:** 2026-05-15

## Problem

`project_user.local_working_directory` is a single text column — one path per user per project, machine-implicit. When an agent runs on a different device, it cannot discover which local path corresponds to its checkout of that project. Multiple devices, CI runners, and colleagues all need to register their own paths for the same project.

---

## Proposed Schema (from prior session)

Two new tables replace the single column:

### `devices`
Tracks persistent device identities. The CLI generates a stable UUID on first run and caches it in `~/.config/overlord/device.json`. Sent as `deviceFingerprint` on every protocol call.

Each device also has a human-readable `label` that is unique per organization, lowercase, kebab-style. Labels are the addressable identifier in the UI, CLI, and protocol calls (e.g. `--device work-macbook`).

```sql
CREATE TABLE devices (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id     bigint      NOT NULL REFERENCES organizations(id),
  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_fingerprint  text        NOT NULL,
  label               text        NOT NULL,  -- unique per org, lowercase, kebab-case
  hostname            text,
  platform            text,
  last_seen_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, device_fingerprint),
  UNIQUE (organization_id, label),
  CONSTRAINT devices_label_format CHECK (label ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$')
);
```

**Label format:**
- Lowercase letters, digits, and hyphens.
- 1–64 characters, must start and end with alphanumeric.
- Unique within an organization (not per-user — a label is meaningful across the whole org so CI/shared devices can be referenced by anyone).

**Auto-generation on first registration** — When the CLI/MCP server hits the server with a `deviceFingerprint` that hasn't been seen before, the server generates a default label:
1. Start with `sanitize(hostname)` — lowercase, replace non-alphanumeric with `-`, collapse repeats, trim.
2. Fall back to `sanitize(platform) + '-device'` if hostname is empty.
3. If the candidate collides with an existing label in the org, append `-2`, `-3`, … until unique.

Users can rename the label later via the UI or `ovld device rename <old> <new>`.

### `project_resource_directories`
One row per `(project, user, device, path)`.

`organization_id` is intentionally omitted — it is fully determined by `project_id` via the `projects` table. All resolution queries are user-scoped (agent flows pass the authenticated `userId`), so the hot-path index is keyed on `user_id` instead.

```sql
CREATE TABLE project_resource_directories (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id       uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id        uuid        REFERENCES devices(id) ON DELETE SET NULL,
  directory_path   text        NOT NULL,
  label            text,
  is_primary       boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id, device_id, directory_path)
);

-- Primary lookup: agent flows always filter by user_id, then match on path.
CREATE INDEX project_resource_directories_user_path_idx
  ON project_resource_directories (user_id, directory_path);

-- Device-scoped lookup: "what dirs does this device have?"
CREATE INDEX project_resource_directories_device_idx
  ON project_resource_directories (device_id)
  WHERE device_id IS NOT NULL;
```

For the rare org-wide UI query (e.g. admin views), the org filter is applied via a join to `projects` — acceptable since it's not on the hot path.

**Note:** SSH fields dropped from this table. All access is assumed local (CLI or MCP running on the device). The existing `project_user` SSH columns are out of scope for this change.

---

## Resolution Algorithm

The updated `resolveProjectByWorkingDirectory` function:

```
1. Normalize workingDirectory → normPath

2. If deviceFingerprint provided:
   a. Look up devices row: (organization_id, user_id, device_fingerprint)
   b. Query project_resource_directories WHERE user_id = <userId> AND device_id = <id>
   c. Exact match on normPath → return project
   d. Longest parent-prefix match → return project
   e. If match found, done.

3. Fallback — device-agnostic:
   Query project_resource_directories WHERE user_id = <userId>
   Apply same exact → parent-prefix logic
   (Join projects to confirm the row's project belongs to the caller's org.)

4. Legacy fallback (migration window):
   Query project_user.local_working_directory as before

5. Return null if nothing matched
```

Callers that never send `deviceFingerprint` hit step 3 (identical behaviour to today).

---

## Affected Files

| File | Change |
|------|--------|
| `supabase/migrations/` | 2 new migrations (devices + project_resource_directories) |
| `supabase/migrations/` | 1 backfill migration (copy local_working_directory) |
| `types/database.types.ts` | Regenerated via `yarn generate` |
| `lib/overlord/resolve-project.ts` | Add new-table query with legacy fallback |
| `lib/overlord/resolve-project-user.ts` | Add new-table query with legacy fallback |
| `lib/overlord/validation.ts` | Add optional `deviceFingerprint` to `discoverProjectSchema`, `recordWorkSchema`, `spawnSchema`, `promptSchema` |
| `supabase/functions/mcp/handlers/discover-project.ts` | Accept `deviceFingerprint`, upsert device row, prefer device-scoped resolution |
| `supabase/functions/mcp/handlers/record-work.ts` | Same as discover-project |
| `apps/web/app/api/protocol/discover-project/route.ts` | Pass `deviceFingerprint` to resolver |
| `apps/web/app/api/protocol/record-work/route.ts` | Pass `deviceFingerprint` to resolver |
| `lib/actions/projects.ts` | `updateProjectWorkingDirectoryAction` — also write to `project_resource_directories` |
| `lib/actions/resource-directories.ts` | New: CRUD actions for `project_resource_directories` |
| UI (project settings) | Replace single text field with a directory list |

---

## Implementation Steps

### Phase 1 — Schema (non-breaking, additive)

**Step 1.** `supabase/migrations/20260516100000_add_devices_table.sql`
- Create `devices` table with `label` NOT NULL and `UNIQUE (organization_id, label)`.
- Add CHECK constraint enforcing kebab-case label format.
- RLS:
  - Users can `SELECT/INSERT/UPDATE/DELETE` their own rows (`user_id = auth.uid()`)
  - Org admins can `SELECT` all within the org
- Create `generate_device_label(org_id, hostname, platform)` SQL function that:
  - Sanitizes the hostname (lowercase, non-alphanumeric → `-`, collapse, trim).
  - Falls back to `<platform>-device` when hostname is empty.
  - Suffixes `-2`, `-3`, … until the candidate is unique in the org.
  - Returns the chosen label.
- The API/MCP handlers call this function during the device upsert when `label` is absent.

**Step 2.** `supabase/migrations/20260516110000_add_project_resource_directories.sql`
- Create `project_resource_directories` table + both indices + RLS:
  - Users can manage their own rows (`user_id = auth.uid()`)
  - Org admins can `SELECT`

**Step 3.** Run `yarn generate` to regenerate `types/database.types.ts`.

---

### Phase 2 — Backfill existing data

**Step 4.** `supabase/migrations/20260516120000_backfill_resource_directories.sql`
- Copy all non-null `project_user.local_working_directory` rows into `project_resource_directories` with `device_id = NULL`, `is_primary = true`.
- Use `INSERT ... ON CONFLICT DO NOTHING` to be idempotent.

---

### Phase 3 — Update resolution logic (with legacy fallback)

**Step 5.** Update `lib/overlord/resolve-project.ts`
- Add a new helper that queries `project_resource_directories` (device-scoped if `deviceId` provided, then org-wide fallback).
- Keep the existing `project_user` query as the final legacy fallback.
- Accept optional `deviceId?: string | null` parameter.
- Signature: `resolveProjectByWorkingDirectory(supabase, orgId, workingDir, userId?, deviceId?)`.

**Step 6.** Update `lib/overlord/resolve-project-user.ts`
- Same pattern: query `project_resource_directories` first, fall back to `project_user.local_working_directory`.
- Accept optional `deviceId?: string | null`.

**Step 7.** Update `lib/overlord/validation.ts`
- Add `deviceFingerprint: z.string().trim().max(128).optional()` to:
  - `discoverProjectSchema`
  - `recordWorkSchema`
  - `spawnSchema`
  - `promptSchema`

**Step 8.** Update `apps/web/app/api/protocol/discover-project/route.ts`
- Extract `deviceFingerprint` from parsed body.
- If provided, upsert a `devices` row and resolve `deviceId`, then pass to resolver.
- The upsert updates `last_seen_at`, `hostname`, `platform` from request metadata.

**Step 9.** Update `apps/web/app/api/protocol/record-work/route.ts` — same as step 8.

**Step 10.** Update MCP edge functions
- `supabase/functions/mcp/handlers/discover-project.ts`
  - Extract `deviceFingerprint` from args.
  - Upsert `devices` row (via supabase client, same pattern as API route).
  - Pass `deviceId` to resolution function.
- `supabase/functions/mcp/handlers/record-work.ts` — same.

**Note on duplication:** The `normalizeDirPath` and `resolveProjectByWorkingDirectory` functions are duplicated between the Next.js lib and the Deno edge functions. They cannot share code until the MCP server is moved to Next.js (separate work). For now, keep them in sync manually.

---

### Phase 4 — Data layer for managing directories

**Step 11.** Create `lib/actions/resource-directories.ts`

New server actions:
```typescript
// List all directories for a project (current user)
getProjectResourceDirectoriesAction(projectId: string): Promise<ProjectResourceDirectory[]>

// Add a new directory entry
addProjectResourceDirectoryAction(input: {
  projectId: string;
  directoryPath: string;
  label?: string;
  deviceId?: string;
  isPrimary?: boolean;
}): Promise<void>

// Remove a directory entry
removeProjectResourceDirectoryAction(directoryId: string): Promise<void>

// Set a directory as primary
setResourceDirectoryPrimaryAction(directoryId: string, projectId: string): Promise<void>
```

**Step 12.** Update `lib/actions/projects.ts` — `updateProjectWorkingDirectoryAction`
- Continue writing to `project_user.local_working_directory` (compatibility).
- Also upsert to `project_resource_directories` with `device_id = NULL, is_primary = true` for the current user.
- This ensures both old and new callers see consistent state.

---

### Phase 5 — UI

**Step 13.** Find the project settings component that renders the working directory field.
- It's surfaced via `useUpdateProjectWorkingDirectoryMutation` in `lib/client-data/projects/mutations.ts`.
- The primary UI appears to be in the project layout / settings section.

**Step 14.** Replace the single text input with a `ResourceDirectoryList` component:
- Lists existing `project_resource_directories` rows for this project+user.
- Shows device label (if known) next to each path.
- Add/remove/label entries.
- Mark one as primary.
- Keep backwards-compatible: if the list is empty, fall back to displaying the `local_working_directory` value from `project_user`.

---

### Phase 6 — Cleanup (out of scope for initial PR)

After full rollout and verification:
- Drop `local_working_directory`, `remote_working_directory`, and SSH columns from `project_user`.
- Remove legacy fallback branches from resolution functions.

---

## Key Decisions

1. **No SSH fields in `project_resource_directories`** — All access is local. SSH columns remain on `project_user` until the remote-access feature is designed separately.

2. **No `organization_id` column** — A project belongs to exactly one organization, so `project_resource_directories.organization_id` would be a denormalization of `projects.organization_id`. All agent-flow resolution queries are user-scoped, so the hot-path index is `(user_id, directory_path)`. Org filtering for admin/UI queries happens via a join to `projects`.

3. **Legacy fallback preserved** — Both new-table resolution and old `project_user` column remain active until cleanup phase. No data loss, no forced migration.

4. **Upsert on fingerprint** — The server upserts the `devices` row on every protocol call that includes a fingerprint, keeping `last_seen_at`, `hostname`, and `platform` current.

5. **`label` is the human-readable identifier** — Required, lowercase kebab-case, unique per organization. No separate sequential ID. The UUID `device_fingerprint` remains the stable client-side identifier; `label` is what appears in UI, CLI flags (`--device work-macbook`), and logs. Auto-generated from hostname on first registration; user-editable afterward.

6. **Unique constraint on `(project_id, user_id, device_id, directory_path)`** — A NULL `device_id` is treated as a distinct value by PostgreSQL unique constraints, so two `NULL`-device rows with the same path would conflict. For the backfill, this is fine. UI-created rows without a device will need to be deduplicated at the application layer.

---

## Open Questions

1. **Device registration UI** — Should users be able to name/manage their devices in the app? Or is the device label only set programmatically by the CLI?
2. **Shared devices** — Should a CI runner device be registered per-org rather than per-user? The current schema is per-user. An `OVERLORD_DEVICE_FINGERPRINT` env var on CI runners would register them under the triggering user, which may be correct.
3. **Desktop app fingerprint** — What stable installation ID does the Overlord desktop app expose? The electron `app.getPath('userData')` could contain a generated ID.
