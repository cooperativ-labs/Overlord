# Unassigned Mission Inbox (coo:574)

**Status:** proposed — Option B, reduced to the requested minimal data model
**Contract impact:** version bump required before implementation
**Modules touched:** `database`, `core` (mission creation service), `rest`, `webapp`, and the separately shipped mobile client
**Desktop:** no shell work; it renders the webapp.

---

## 1. Decision

Use **Option B**: an account-owned `inbox_items` table. An inbox item is a small,
unassigned mission draft, not a row in `missions`. When the user selects a project,
the service creates an ordinary mission in that project's workspace and removes the
inbox item in the same transaction.

This is intentionally not a hidden Inbox project and not a nullable `missions.project_id`:

- A real mission is workspace-owned (`workspace_id`, `project_id`, status, display ID,
  memberships, and child foreign keys). It cannot remain available to its owner after
  that owner loses workspace access.
- A profile-owned inbox item has no workspace, organization, project, agent, resource,
  status, assignee, tag, board position, session, attachment, event, or artifact.
  It is private to its owner and can be promoted into any project where that owner has
  `mission:create`, including a project in a different organization.
- Promotion uses the existing mission-create path. The target workspace therefore
  assigns every normal mission field correctly at creation, rather than attempting a
  fragile cross-workspace move or re-home.

The prior draft's position, revision, arbitrary metadata, and promoted-item tombstones
are deliberately out of scope. They are not needed to capture or assign work, and can
be added later without changing this ownership model.

---

## 2. Minimal data model

Add paired SQLite and Postgres migrations for `inbox_items`.

```sql
-- Account-owned, unassigned mission drafts (coo:574).
CREATE TABLE inbox_items (
  id text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,

  title text NOT NULL CHECK (char_length(btrim(title)) > 0),
  -- JSON array of objective strings. v1 accepts exactly one non-empty item;
  -- retaining an array avoids a schema change when multi-objective capture is added.
  objectives_json jsonb NOT NULL,
  due_datetime timestamptz,
  priority text CHECK (priority IS NULL OR priority IN ('low', 'normal', 'high', 'urgent')),

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX idx_inbox_items_profile_created_at
  ON inbox_items (profile_id, created_at DESC);
```

SQLite uses its normal `text` representation for timestamps and JSON. The service
validates `objectives_json` as an array of trimmed strings and enforces exactly one
entry in v1. That preserves a forward-compatible array shape without prematurely
adding multi-objective editing behavior.

`profile_id` is the necessary ownership key, not a mission feature field. The product
data fields are exactly:

| Field | Purpose |
| --- | --- |
| `title` | Capture title. |
| `objectives_json` | One objective now; array-shaped for future multiple objectives. |
| `due_datetime` | Optional due date/time. |
| `priority` | Optional mission priority. |
| `created_at`, `updated_at` | Standard lifecycle timestamps. |

There is no `workspace_id`, `organization_id`, `project_id`, `status_id`, agent,
resource, assignee, tag, board position, display ID, or execution state. Those are
assigned only when promotion creates the actual mission.

---

## 3. Authorization and lifecycle

### 3.1 Ownership

Inbox items are profile-owned. A caller may read, update, delete, or promote an item
only when `inbox_items.profile_id` equals the caller's resolved profile ID. Return 404
for another profile's ID to avoid revealing its existence.

This authorization does not require an active workspace or organization. Removing the
owner from a workspace cannot affect their captures, because no inbox row references a
workspace.

### 3.2 Promotion

`POST /api/inbox/:id/promote` accepts only:

```ts
interface PromoteInboxItemBody {
  projectId: string;
}
```

The server:

1. loads the live item scoped to the caller's `profile_id`;
2. authorizes `mission:create` against the selected project's own workspace via the
   existing `requireProjectPermission` path;
3. calls the existing transaction-safe mission-create service with the item title,
   objective array, due date, and priority;
4. lets that service assign the target workspace's default status, display ID,
   workspace membership fields, project, and all ordinary mission defaults; and
5. deletes the inbox item in the same transaction and returns the created `MissionDto`.

The first release creates one draft objective from the array's sole item. When
multi-objective capture ships, this call maps each array item to a draft objective; no
inbox-table migration is needed.

There is no cross-workspace move, status remapping, display-ID renumbering, child-table
cascade, or inbox-item tombstone. The mission only begins to exist when it belongs to
its destination project. A client navigates using the `MissionDto` returned by promotion.

---

## 4. API surface

Add a small profile-scoped REST module, for example `backend/inbox.ts`:

| Route | Behavior |
| --- | --- |
| `GET /api/inbox` | List the caller's items, newest first. |
| `POST /api/inbox` | Create with title, one-item objective array, optional due date, and optional priority. |
| `GET /api/inbox/:id` | Read one owned item. |
| `PATCH /api/inbox/:id` | Edit only title, objective array, due date, or priority. |
| `DELETE /api/inbox/:id` | Delete an owned unassigned item. |
| `POST /api/inbox/:id/promote` | Create an ordinary mission in `projectId` and consume the item. |

Additive DTOs:

```ts
interface InboxItemDto {
  id: string;
  title: string;
  objectives: string[];
  dueDatetime: string | null;
  priority: MissionPriority | null;
  createdAt: string;
  updatedAt: string;
}

interface CreateInboxItemBody {
  title: string;
  objectives: string[]; // exactly one non-empty string in v1
  dueDatetime?: string | null;
  priority?: MissionPriority | null;
}
```

`missions`, `objectives`, `projects`, their existing create and move endpoints, mission
search, boards, My Missions, webhooks, and realtime entity changes remain unchanged.
An inbox item is not a mission until promotion.

For v1, the acting client invalidates and refetches its inbox query after a mutation.
`entity_changes.workspace_id` is workspace-bound, so account-owned inbox records do not
enter that stream. Promotion naturally emits the normal mission entity change in the
target workspace through the mission-create path.

---

## 5. Web, desktop, and mobile

### Web + desktop

1. Add an **Inbox** entry above **My Missions** with a count of live items.
2. Add an Inbox page: a flat list with a lightweight editor for title, one objective,
   due date, and priority. No board, status, agent, resource, tag, attachment, or run
   controls appear here.
3. Let the normal mission composer select **No project (Inbox)**. That mode hides the
   project-dependent controls and posts to `POST /api/inbox`.
4. Each inbox row exposes a project picker. Selecting a project promotes it; the client
   removes the row and opens the returned mission.
5. The promotion picker lists projects the user can create missions in across all of
   their organizations and workspaces. Group results by organization then workspace.

### Mobile (separate repository)

After the REST API is live, add the same account Inbox section to the mobile home screen
and the same minimal capture/edit/promote flow. It uses `InboxItemDto`; existing mission
and project DTOs do not change.

---

## 6. CLI and MCP capture

Inbox capture must be available to agents and must be the safe default when they cannot
identify a project.

### CLI

- Add `ovld protocol create --inbox` as the explicit capture mode. It accepts the same
  title/objective, due-date, and priority inputs as normal non-executing creation and
  returns the new inbox-item ID and its account-owned status.
- Add `ovld inbox create` as the concise human/agent alias for `protocol create --inbox`.
- Change the non-executing `ovld protocol create` resolution order to: explicit
  `--project-id`; then an explicitly discovered project; otherwise create an inbox item.
  An agent that cannot resolve a project therefore captures the requested work instead of
  failing or guessing a project.
- `ovld protocol prompt` and `ovld protocol record-work` continue to require a resolved
  project. They imply an executable checkout, agent, and resource, which an inbox item
  deliberately does not have.

### MCP

- Make `projectId` optional on `overlord_create_mission`. With a project it keeps the
  existing mission-create behavior; without one it creates an inbox item and returns its
  inbox ID, title, one-objective array, and an explicit `unassigned: true` marker.
- Add `overlord_create_inbox_item` for callers that want to state capture intent without
  relying on fallback. Its input is only the minimal inbox fields.
- The local MCP shim follows the same behavior with its snake_case project argument.
  Agent guidance says to pass a project when it is known; otherwise omit it and let the
  inbox fallback preserve the task.

Neither path treats an inbox ID as a mission ID, and neither auto-runs an inbox item.
Promotion remains a user-facing project-selection action in this release.

---

## 7. Contract-first changes

Before implementation, update `CONTRACT.md`, `contract/components.yaml`, and the
relevant contract documents, then bump the contract version. The contract change must
cover:

1. The `inbox_items` database table and the closed priority vocabulary it reuses.
2. Profile-owned resource authorization: identity is the owning `profiles.id`, outside
   workspace RBAC and unaffected by membership removal.
3. The inbox REST routes and DTOs.
4. The promotion rule: authorize on the destination project with `mission:create`, then
   create an ordinary mission there and consume the account-owned capture.
5. The deliberate v1 realtime rule: inbox records are not workspace entity changes;
   clients refetch locally, while promotion uses existing mission realtime behavior.
6. `ovld protocol create --inbox`, the no-project discovery fallback, and the statement
   that `prompt` and `record-work` do not fall back.
7. Optional `projectId` plus the inbox return shape on `overlord_create_mission`, and the
   explicit `overlord_create_inbox_item` tool.

No `projects.kind`, optional `POST /api/missions.projectId`, cross-workspace mission
re-home, or new controlled project vocabulary is required.

---

## 8. Phasing

| Phase | Scope | Deliverable |
| --- | --- | --- |
| 1 — Contract | Contract and schema contract updates. | Versioned interfaces describe the profile-owned capture model. |
| 2 — Data + API | Both migrations and the six REST handlers. | A user can create, edit, list, delete, and promote a minimal private capture. |
| 3 — CLI + MCP | Explicit capture commands/tools and no-project fallback. | Agents retain unprojected work instead of failing or guessing. |
| 4 — Web + desktop | Inbox page, composer mode, picker, and query invalidation. | End-to-end browser and desktop workflow. |
| 5 — Mobile | Mobile client integration in its own repository. | Same minimal capture and promotion flow on mobile. |

Attachments, ordering, unread state, tombstone redirects, and multi-objective editing
are follow-on work, not prerequisites for this feature.

---

## 9. Tests

- Apply the migration on SQLite and Postgres; verify profile deletion cascades only its
  inbox items.
- Validate API create/update rejects empty titles, non-array objectives, and arrays that
  do not contain exactly one non-empty string in v1.
- Verify profile isolation: another user receives 404 for every item route.
- Remove a user from every workspace, then verify they can still read/edit/delete their
  inbox item and promote it into a project in a different organization where they retain
  `mission:create`.
- Verify promotion creates a normal destination mission with the item title, objective,
  due date, and priority; the destination provides project, status, display ID,
  membership fields, and all other normal defaults.
- Verify promotion rejects projects without `mission:create`, and that an item is not
  left behind when creation succeeds or lost when creation fails.
- Verify `ovld protocol create --inbox`, `ovld inbox create`, and
  `overlord_create_inbox_item` create an inbox item with the minimal payload.
- Verify normal non-executing CLI and MCP mission creation falls back to an inbox item
  when no project is supplied or discovered, while an explicit project always wins.
- Verify `prompt` and `record-work` still reject an unresolved project rather than
  creating an unexecutable inbox item.
- Verify mission lists, boards, search, and existing mission create endpoints are
  unchanged.
- Verify the web composer sends only the minimal inbox fields in Inbox mode and
  invalidates the inbox plus destination mission queries after promotion.

---

## 10. Deferred work

- Multi-objective capture: permit more than one string in `objectives_json` and map each
  string to a draft objective during promotion.
- Attachments before a project is selected.
- Manual ordering, unread counts, deep-link redirect tombstones, and account-level
  realtime events.

None of these change the selected data model; the JSON objective array is specifically
the forward-compatible seam for the first item.
