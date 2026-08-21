# MCP and CLI Run Queue Management

Mission: `coo:802` — Manage MCP Queues
Planning objective: `coo:802.qe54`
Status: plan (no implementation in this objective)
Contract baseline: `105`

## 1. Goal

Agents must be able to **add objectives to a Run Queue, remove them, and reorder
them** from the hosted MCP server and the connector MCP shim. The CLI (`ovld
protocol …`) must expose the same capabilities. Nothing new is built below the
service layer — every operation already exists in
`packages/core/service/run-queue.ts` and is already exposed over REST for the web
app. This is a **surface-parity** feature: lift the existing Run Queue service to
the agent-facing surfaces.

## 2. Current state

`packages/core/service/run-queue.ts` is the single authority. It exports nine
operations; the web app reaches all nine through REST
(`webapp/web/lib/api.ts:488-510`). The agent surfaces reach far fewer.

| Capability | Core service | REST | Protocol / CLI | Hosted MCP | Local shim |
|---|---|---|---|---|---|
| Read all queues + entries | `listProjectRunQueues` | `GET /api/projects/:id/run-queues` | `run-queue` (needs `--project-id`) | **missing** | **missing** |
| Add objective to a queue | `enqueueRunQueueEntry` | `POST …/run-queues/entries` | `queue-objective` | `overlord_queue_objective` | same |
| Move one entry | `moveRunQueueEntry` | `PATCH /api/run-queues/entries/:entryId` | `queue-objective` (`--queue`/`--after`/`--front`/`--position`) | **partial** — only `queue` + `after` | **partial** |
| Remove entry | `removeRunQueueEntry` | `DELETE /api/run-queues/entries/:entryId` | `dequeue-objective` | `overlord_queue_objective` (`remove: true`) | same |
| Reorder every entry in a queue | `reorderRunQueue` | `PATCH /api/run-queues/:queueId/order` | **missing** | **missing** | **missing** |
| Create a queue | `createRunQueue` | `POST /api/projects/:id/run-queues` | **missing** | **missing** | **missing** |
| Rename / pause / resume a queue | `updateRunQueue` | `PATCH /api/run-queues/:queueId` | **missing** | **missing** | **missing** |
| Delete a queue | `deleteRunQueue` | `DELETE /api/run-queues/:queueId` | **missing** | **missing** | **missing** |
| Reorder the queues themselves | `reorderProjectRunQueues` | `PATCH …/run-queues/order` | **missing** | **missing** | **missing** |

Two gaps matter most for the stated objective:

1. **MCP agents cannot read the queue.** `overlord_queue_objective` can add,
   move, and remove — but there is no MCP tool that returns
   `ProjectRunQueuesDto`. An agent cannot reliably reorder a queue it cannot
   see, and cannot confirm that its own mutation landed.
2. **Nobody above the service can bulk-reorder.** Reordering today means
   issuing N sequential `--after` moves, which is racy against the dispatcher
   and against concurrent agents. `reorderRunQueue` exists and is transactional;
   it is simply not reachable.

Smaller gaps: `overlord_queue_objective` lacks the `front` / `position`
placement the CLI already has, and `run-queue` demands a `--project-id` that a
mission-scoped agent usually does not hold.

## 3. Design principles

- **No second queue implementation.** Every new command and tool is a thin
  resolver + delegate onto `packages/core/service/run-queue.ts`, exactly as the
  existing `queue-objective` handler is. No new SQL, no new tables, no logic in
  the MCP layer.
- **Protocol is the only backend surface MCP touches.** Hosted MCP
  (`mcp/server.ts`) and the shim (`connectors/core/scripts/overlord-mcp.mjs`)
  both forward to `runProtocolSubcommand`. Every new MCP tool therefore requires
  its protocol subcommand first; the MCP layer only maps camelCase args to
  flags.
- **Accept the identifiers agents actually hold.** Objective display ids
  (`coo:802.qe54`), queue names, mission ids. Agents rarely hold entry UUIDs or
  project UUIDs, so every new reference argument resolves UUID *or* display id
  *or* unambiguous name, mirroring `queueByRef` / `resolveObjectiveRef`.
- **Failed ordering must be self-correcting.** `reorderRunQueue` requires the
  complete live entry set exactly once. When the caller's list does not match,
  the error must carry the current ordered list back so the agent can retry in
  one step instead of guessing.
- **Read tools stay small.** A full `ProjectRunQueuesDto` for a busy project is
  large. The read tool supports narrowing by queue and returns a compact
  projection by default.
- **Tool-count discipline.** Hosted MCP has 19 tools today. This adds 3, not 6:
  queue-definition lifecycle collapses into one `action`-dispatched tool.

## 4. Proposed surface

### 4.1 New protocol subcommands

All names stay in the existing `run-queue` family. `reorder-run-queue` (entries
inside one queue) and `reorder-project-run-queues` (the queue definitions in a
project) are deliberately spelled far apart — a one-character difference between
two destructive-ordering commands is a foot-gun.

| Subcommand | Required | Optional | Response | Permission |
|---|---|---|---|---|
| `run-queue` *(existing, relaxed)* | — | `--project-id`, `--objective-id`, `--mission-id`, `--queue` | `ProjectRunQueuesDto` | `objective:read` |
| `reorder-run-queue` | `--queue`, `--ordered-entries-json` \| `--ordered-entries-file` | `--project-id`, `--objective-id` | `RunQueueDto` | `execution_request:create` |
| `create-run-queue` | `--project-id`, `--name` | — | `RunQueueDto` | `project:update` |
| `update-run-queue` | `--queue` | `--project-id`, `--name`, `--pause`, `--resume` | `RunQueueDto` | `project:update` |
| `delete-run-queue` | `--queue` | `--project-id`, `--move-entries-to` | `{ removed, projectId }` | `project:update` |
| `reorder-project-run-queues` | `--project-id`, `--ordered-queues-json` \| `--ordered-queues-file` | — | `ProjectRunQueuesDto` | `project:update` |

Behavioural rules:

- **`run-queue` project resolution.** `--project-id` becomes optional. When it
  is absent and `--objective-id` or `--mission-id` is present, the project is
  derived from that objective/mission. When neither is present, the existing
  `Missing required flag: --project-id` error stands. When `--project-id` *and*
  an objective ref are both present and disagree, reject with the same
  `--project-id does not own the addressed objective` message
  `queueObjectiveFromProtocol` already uses. `--queue` narrows the response to
  one queue (by UUID or unambiguous name) without changing the DTO shape.
- **`reorder-run-queue` input.** `--ordered-entries-json` is a JSON array whose
  items are entry UUIDs, objective UUIDs, or objective display ids — resolved
  per item against the addressed queue's live entries, so an agent can echo back
  the `objectiveDisplayId` values it just read. The resolved list is passed to
  `reorderRunQueue`, which enforces completeness, rejects duplicates, and
  refuses to move a `running`/`dispatched` entry. On any of those rejections the
  handler adds `currentOrder` (the live ordered `objectiveDisplayId` list) and
  `runningEntryId` to the error detail so the agent can retry immediately.
  `--queue` may be a UUID or an unambiguous name; a name needs a project, which
  comes from `--project-id` or `--objective-id`.
- **`update-run-queue` pause.** `--pause` and `--resume` are mutually exclusive
  boolean flags mapping to `updateRunQueue`'s `paused`. Passing neither, with a
  `--name`, renames only. Passing nothing at all is a 400, not a no-op — a
  silently-successful no-op teaches an agent that its intent landed.
- **`delete-run-queue`.** Delegates to `deleteRunQueue`, which already refuses
  the default queue (`default_run_queue`, 409) and refuses a non-empty queue
  without a destination (`run_queue_not_empty`, 409). `--move-entries-to`
  accepts a UUID or unambiguous name.
- **`reorder-project-run-queues`.** Items are queue UUIDs or unambiguous names.
  `reorderProjectRunQueues` already enforces that the default queue stays first
  (`default_run_queue_position`, 409); surface that message verbatim.

### 4.2 CLI

The CLI forwards protocol flags without validating them
(`cli/src/flag-registry.ts` deliberately omits `protocol`), so CLI work is:

1. Add the five new names to `SUPPORTED_PROTOCOL_SUBCOMMANDS`
   (`cli/src/protocol-help.ts`).
2. Add a help block per subcommand in the same file, matching the existing
   `queue-objective` / `dequeue-objective` entries in tone and depth, and update
   the `Subcommands:` summary list.
3. Add `--ordered-entries-file` and `--ordered-queues-file` to
   `PROTOCOL_FILE_FLAGS` (`cli/src/commands.ts:713`) so `-` stdin piping works
   for long orderings — the same treatment `--objectives-file` gets. **Note an
   existing bug to fix in passing:** `--ordered-objective-ids-file` is accepted
   by the backend (`reorder-future-objectives`) but is *not* in
   `PROTOCOL_FILE_FLAGS`, so stdin piping for it silently does not work today.

### 4.3 MCP tools

Three new tools plus one extension, defined identically in
`mcp/tool-catalog.ts` (camelCase, hosted) and
`connectors/core/scripts/overlord-mcp.mjs` (the shim's own copy of the
definitions and its `runProtocol` mapping).

**`overlord_list_run_queues`** — read-only (`readOnly` annotations).

```
projectId?   string   Project id, slug, or name.
objectiveId? string   Objective UUID or display id; supplies the project when projectId is absent.
missionId?   string   Mission UUID or display id; same role.
queue?       string   Optional queue UUID or unambiguous name to narrow the result.
detail?      'compact' | 'full'   Default 'compact'.
```

`compact` returns, per queue: `id`, `name`, `isDefault`, `paused`, and per entry
`position`, `state`, `objectiveDisplayId`, `objectiveTitle`, `missionTitle`,
`blockedReason`. `full` returns the raw `ProjectRunQueuesDto`. This mirrors the
`detail` pattern `overlord_search_missions` already uses, and keeps a
50-entry queue from flooding an agent's context.

**`overlord_reorder_run_queue`** — write.

```
queue              string    Queue UUID or unambiguous name.               (required)
orderedObjectives  string[]  Complete top-to-bottom order; entry UUIDs,    (required)
                             objective UUIDs, or objective display ids.
projectId?         string    Needed only to disambiguate a queue name.
```

Description must state plainly: *supply every live entry exactly once; running
and dispatched entries cannot move; on mismatch the error returns the current
order — re-read it and retry.*

**`overlord_manage_run_queue`** — write, `action`-dispatched.

```
action        'create' | 'update' | 'delete' | 'reorder_queues'   (required)
projectId?    string     Required for create and reorder_queues.
queue?        string     Required for update and delete.
name?         string     create: the new name. update: rename.
paused?       boolean    update only.
moveEntriesTo? string    delete only; required when the queue is not empty.
orderedQueues? string[]  reorder_queues only; every queue, default queue first.
```

One tool rather than four keeps the catalog legible and reflects that these are
rarely-used administrative actions. Argument validation per action happens in
the MCP layer before the protocol call, with explicit messages
(`"action 'delete' requires queue"`).

**`overlord_queue_objective`** — extended with the placement the CLI already
has:

```
front?    boolean   Place first in the selected queue.
position? number    One-based insertion rank.
```

mapping to `--front` / `--position`, with the existing mutual-exclusion rule
(`after`, `front`, `position` — at most one) enforced client-side in the MCP
layer so the agent gets the error without a round trip.

## 5. RBAC and token scope — a real constraint

`MISSION_LIFECYCLE_GRANTS` (`auth/src/rbac/permissions.ts:138`) contains
`execution_request:create` but **not** `project:update`. Therefore:

- **Entry-level work — add, remove, move, bulk reorder — works for a
  `mission_lifecycle`-scoped agent token.** This is exactly what the objective
  asks for, and it is fully unblocked.
- **Queue-definition lifecycle — create, rename, pause, delete, reorder
  queues — will be denied for a scoped agent token**, because the existing REST
  mapping (`backend/run-queue.ts`) requires `PROJECT_UPDATE` and the protocol
  subcommand map must match it. It works for a `full`-scope token (a human's
  `ovld auth login`).

That asymmetry is the reason queue lifecycle is phased separately (Phase 3)
rather than bundled. Two options if agents must manage queue definitions:

- **(a) Keep `project:update`** — ship Phase 3 as a human/full-token surface and
  document the limitation. *Recommended:* it is the honest mapping, it matches
  REST, and creating/deleting queues is a project-configuration act.
- **(b) Introduce `run_queue:manage`** — a new permission added to
  `MISSION_LIFECYCLE_GRANTS`, applied to both the REST handlers and the new
  subcommands. This widens what every existing agent token can do to project
  configuration and needs its own RBAC review.

**Open decision for the mission owner: (a) or (b).** Phases 1 and 2 do not
depend on the answer and should not wait for it.

## 6. Contract changes

Bump `CONTRACT.md` `Current version` and `contract/components.yaml`
`contractVersion` to `106`, with a "Version 106 Change Summary" recording an
additive Run Queue agent surface. Also:

- `contract/protocol-commands.yaml`: add `reorderRunQueue`, `createRunQueue`,
  `updateRunQueue`, `deleteRunQueue`, `reorderProjectRunQueues`; amend
  `runQueue` (move `--project-id` to optional, add the derivation rule and
  `--queue`); amend `queueObjective` only if its flags change (they do not —
  `--front`/`--position` already exist).
- `CONTRACT.md` protocol-layer bullet (line ~365) and the Run Queue REST family
  bullet (line ~491): extend the agent-operations sentence to name the new
  subcommands and state the `project:update` vs `execution_request:create`
  split.
- `mcp/conformance-manifest.yaml`: `contractVersion` is stale at `104`; set it
  to `106` and list the new tools.

## 7. Documentation

Drift across these surfaces is a recurring problem here (`/drift-review`
exists for exactly this), so docs are in-scope, not follow-up:

- `mcp/README.md` — tool list and the queue paragraph at lines 78–127.
- `connectors/core/overlord-mission/reference/mcp.md` — new tool names.
- `connectors/core/overlord-mission/reference/cli.md` line 184 — new subcommands.
- `docs/src/content/docs/mcp.mdx` and `docs/src/content/docs/cli.mdx`.
- `cli/src/protocol-help.ts` is itself the CLI reference (see 4.2).

## 8. Testing

- `backend/protocol-auto-advance.test.ts` is the precedent harness — it drives
  `runProtocolSubcommand` directly against a seeded project. Add
  `backend/protocol-run-queue.test.ts` covering: bulk reorder happy path;
  incomplete list rejected *with* `currentOrder` in the detail; running entry
  refused; objective-display-id items resolved; `run-queue` project derived from
  `--objective-id`; project/objective mismatch rejected; create/rename/pause/
  delete/reorder-queues happy paths; default-queue delete and default-queue
  reposition both 409.
- Token-scope test in `auth/src/rbac/scopes.test.ts` style asserting a
  `mission_lifecycle` token can bulk-reorder entries and cannot create a queue —
  this pins the Section 5 decision in code.
- MCP argument-mapping tests alongside `backend/mcp.test.ts`: each new tool
  produces the expected subcommand and flags; `overlord_manage_run_queue`
  rejects each missing-argument combination; `queue_objective` rejects
  `after` + `front` together.
- Shim parity check: the shim's tool list must equal the hosted catalog's for
  every shared tool name (the two files hold independent copies today, which is
  itself the drift risk).

## 9. Phasing → implementation objectives

Each phase is one agent prompt and is independently shippable.

**Phase 1 — Protocol + CLI entry operations.**
`reorder-run-queue`; relax `run-queue` project resolution and add `--queue`;
CLI subcommand list, help blocks, and `PROTOCOL_FILE_FLAGS` (including the
`--ordered-objective-ids-file` fix). Backend tests. This alone makes bulk
reorder reachable from a terminal.

**Phase 2 — MCP entry operations.**
`overlord_list_run_queues` and `overlord_reorder_run_queue` in both
`mcp/tool-catalog.ts` and the shim, plus `front`/`position` on
`overlord_queue_objective`. MCP mapping tests. **This is the phase that
satisfies the objective as stated** — after it, an MCP agent can add, remove,
reorder, and verify.

**Phase 3 — Queue-definition lifecycle.**
`create-run-queue`, `update-run-queue`, `delete-run-queue`,
`reorder-project-run-queues` in protocol + CLI, and `overlord_manage_run_queue`
in both MCP surfaces. Gated on the Section 5 permission decision; ships under
option (a) unless told otherwise.

**Phase 4 — Contract and documentation.**
Contract version bump, `protocol-commands.yaml` entries, conformance-manifest
refresh, and every doc surface in Section 7. Last, so it records what actually
shipped.

## 10. Risks

- **Concurrent dispatch during reorder.** The dispatcher may promote an entry
  between an agent's read and its reorder. `reorderRunQueue` is transactional
  and already refuses to move a running entry, so the failure mode is a clean
  409, not corruption — provided the error carries `currentOrder` back
  (Section 4.1).
- **Shim/catalog divergence.** Two hand-maintained copies of the tool
  definitions. Phase 2 must edit both; the parity test in Section 8 is the
  guard. Generating the shim from the catalog is a worthwhile but separate
  refactor.
- **Context cost.** Three more tools in every MCP session. The `compact`
  default on the read tool is the mitigation.
- **`autoAdvance` coupling.** `enqueueRunQueueEntry` and `removeRunQueueEntry`
  write the deprecated `objectives.auto_advance` column. New commands inherit
  that behaviour unchanged; nothing here accelerates or blocks its retirement.
