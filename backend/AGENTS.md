# Backend Module — Agent Extension Guide

This file tells agents how to extend the **REST API Layer** (`rest`) — the Express REST + SSE realtime server that lives in `backend/`. Read [`contract/CONTRACT.md`](../contract/CONTRACT.md) and the [component-contract skill](../.claude/skills/component-contract/SKILL.md) before making any cross-module change.

The React SPA that consumes this surface lives in [`webapp/`](../webapp/AGENTS.md). Typed DTOs live in `@overlord/contract` (`packages/contract/`); `webapp/shared/contract.ts` is a re-export shim for SPA imports.

> **Temporary deviation:** some landed `backend/` paths still read/write SQLite/Postgres tables directly instead of going through the shared service layer in `packages/core/service/`. The rule below (REST handlers call the service layer, never tables directly) still holds — move direct-table writers onto the shared service layer as those areas are touched. Do not add new direct-table writers without recording the same caveat.
>
> **Recorded owner — storage:** `backend/storage.ts` owns uploaded objects: bucket resolution, byte I/O against the storage backends (`backend/storage-backends.ts`), image uploads (user, workspace, organization), the `user_images` / `workspace_images` / `attachments` metadata writers, and the authenticated serve path. Attachments go through one set of primitives there (`writeAttachmentObject`, `insertAttachmentRow`, `attachmentStoredObjects`, `tombstoneAttachmentRows`); `storage.ts` owns objective attachments and `backend/inbox-attachments.ts` owns Inbox attachments (ownership gate, storage-workspace selection, cross-workspace copy, re-point on promotion) on top of those primitives. `inbox-attachments.ts` imports `storage.ts`, never the reverse. The bucket-key vocabulary (`StorageBucketKey` in `@overlord/contract`) has one descriptor, `STORAGE_BUCKETS` in `backend/storage-buckets.ts`: each key's scope, metadata table, read and upload permissions, and download flag. The upload and serve routes, `resolveStoredObject`, and the workspace bucket seeds read it; add a bucket there, not as another key map. The only other writers are account purge (`backend/account-deletion.ts` deletes `user_images` rows and their bytes) and the organization-logo byte purge in `backend/organizations.ts`. There is no core storage service; do not move these writers onto `packages/core/service/` and do not add new writers for these tables outside `backend/storage.ts`. Protocol's only attachment read is `listAttachments` in `packages/core/service/missions.ts`. A core storage service becomes worth building only when a non-REST surface (Protocol, CLI) needs to write these tables, and it must first support (1) resource-scoped authorization — authorize against the workspace that owns the object (as `requireWorkspacePermission` does here), never the ambient `ctx.workspace` — and (2) profile-owned rows with no workspace (user images, Inbox attachments). The earlier `packages/core/service/storage.ts` met neither and had no production callers, so it was deleted (refactor review 2026-11-01, F1).

---

## What "extending the backend" means

Extensions in this module fall into three categories:

| Extension type | Example user request |
| --- | --- |
| New REST endpoint | "Add `GET /api/missions/:id/artifacts`" |
| New realtime event | "Push mission-status changes over SSE" |
| REST extension module | "Add a namespaced `/ext/myapp/` endpoint set" |

Each type has a different procedure below.

---

## Before You Start

1. Read `contract/architecture.md` — REST API Layer section (stable id: `rest`).
2. Read the "REST API Boundary" section of [`contract/data/README.md`](../contract/data/README.md) — it defines the DTO shape contract (camelCase field names derived from the logical schema).
3. Confirm the endpoint follows the shared **service layer** pattern: REST handlers must never write to database tables directly — they call the same service layer as the CLI and protocol surfaces.
4. Prefer matching an existing domain module's shape (`backend/webhooks.ts`, `backend/organizations.ts`, `backend/ext/github/`) over inventing a new directory layout.

---

## Adding a New REST Endpoint

REST endpoints are stable interfaces. URL paths and HTTP method contracts, once shipped, require a contract update to change.

**Steps:**

1. **Confirm the DTO shape** against `contract/data/README.md`. Response field names are camelCase versions of the logical schema column names. Add or extend types in `@overlord/contract` (`packages/contract/`) when the response is new.
2. **Update `contract/architecture.md`** REST API Layer section with the new path, method, and response shape, in the same change as the handler.
3. **Increment the contract version** in `contract/components.yaml` if the new endpoint changes a previously-stable response schema or removes/renames an existing path.
4. **Implement in `backend/`**: put domain logic in a top-level module (e.g. `backend/webhooks.ts`) or an existing subdirectory (`backend/execution/`, `backend/branching/`, `backend/http/`), colocating tests as `backend/<name>.test.ts`. Register the HTTP route in `backend/index.ts` behind `requireAuthenticatedSession` (already applied to `/api` via `app.use('/api', …)` for most routes). Follow the existing `handle(...)` helper for auth-gated handlers.
5. **Auth before service call**: validate the request token via the Auth Layer, resolve the `Actor`, then call `can(actor, action, resource)` / `requirePermission(...)` before any mutation.
6. **Reach persistence only through the service layer** — the same service functions used by `cli/` and protocol surfaces.
7. **Idempotency**: write-operations that can be retried (e.g. from a client retry on timeout) must use REST-scope idempotency keys in `idempotency_keys`.
8. **Write integration tests** that cover auth failure, happy path, and conflict (409) cases.

---

## Adding a New Realtime Event (SSE/WebSocket)

The SSE/WebSocket realtime endpoint is owned by the REST API Layer. New event types are additions to the open vocabulary.

**Steps:**

1. **Define the event type name** using a namespaced string if it is extension-specific (e.g. `myapp:mission.updated`), or a plain name if it is core (e.g. `mission.status_changed`).
2. **Update `contract/data/README.md`** if the event type derives from `entity_changes` — note it in the "Realtime/Sync" section.
3. **Implement via `backend/realtime.ts`** (and the `recordChange` helpers in `backend/db.ts`). Events must be derived from `entity_changes` rows written in the same transaction as the domain mutation — never computed separately. Canonical stream: `GET /realtime`; catch-up: `GET /sync/changes?after=<seq>`.
4. **Document the event shape** (type, payload fields) in `contract/architecture.md` REST API Layer section.

**Sanctioned exception — the private assistant event channel (contract v152).** Chat
events (`GET /api/chat/threads/:id/events`) do **not** derive from `entity_changes`.
They are private to one owner and too frequent for the change log, so they are
persisted to `chat_events` (gap-free per-thread `seq`, append-only, bounded retention)
in the same transaction as the chat state change, then sent; replay always reads
storage and passes through the source-authorization projection, so a revoked source's
content is never replayed. Chat writes must not append `entity_changes`,
`outbox_messages`, or `search_documents`; missions created by chat Create emit their
normal rows. Conversation notifications use `chat_notifications`, not `worker_jobs`.
No other feature may reuse this exception without a contract change.

---

## Adding a REST Extension Module

Third-party REST extensions use a namespaced endpoint prefix so they cannot conflict with core routes.

**Rules:**
- All extension endpoints must be under `/ext/<name>/` (e.g. `/ext/myapp/reports`).
- Extension routes must still authenticate via the Auth Layer and call through the service layer.
- Declare the extension in a `conformance-manifest.yaml` with `componentType: rest-module`.

**Steps:**

1. **Create `backend/ext/<name>/routes.ts`** with the namespaced route prefix (see `backend/ext/github/` and `backend/ext/everhour/` as references).
2. **Create `backend/ext/<name>/conformance-manifest.yaml`** declaring `componentType: rest-module` and `componentKey: <name>`.
3. **Register the extension router** in `backend/index.ts` with `app.use('/ext/<name>', requireAuthenticatedSession, create…Router(handle))`.
4. **Validate**: `ovld contract check backend/ext/<name>/conformance-manifest.yaml`.

---

## File Placement Convention

```
backend/
  index.ts              ← Express app entry; route registration
  db.ts                 ← DatabaseClient connection + entity_changes writer
  repository.ts         ← core per-resource reads/mutations
  realtime.ts           ← SSE emitter driven by the entity_changes feed
  rbac.ts               ← REST-side permission helpers
  storage.ts            ← storage owner: buckets, bytes, image uploads,
                          attachment primitives + objective attachments,
                          serve path (see "Recorded owner — storage" above)
  inbox-attachments.ts  ← Inbox attachment owner over storage.ts's primitives
  storage-backends.ts   ← local_fs / s3 / railway_volume byte backends
  storage-buckets.ts    ← STORAGE_BUCKETS: the one descriptor per bucket key
  <domain>.ts           ← top-level domain modules (webhooks, organizations, …)
  <domain>.test.ts      ← colocated tests
  http/                 ← request helpers (meta, origins, SPA serving, device hints)
  agent-catalog.ts      ← workspace agent catalog defaults and CRUD
  execution/launch-settings.ts ← per-user launch settings and project preferences
  execution/            ← runner / launch / local-target helpers
  connections/          ← account connections (sole credential store for external
                          accounts), shared AES-256-GCM envelopes, outbound
                          Knowledgebase MCP client, live chat source checks
  branching/            ← branch observations and related routes
  ext/
    <name>/             ← namespaced extension routes
      routes.ts
      service.ts
      conformance-manifest.yaml
  <domain>.postgres-conformance.test.ts ← tests shared against SQLite and Postgres
  <domain>.live-eval.ts ← manually run, credentialed model evaluations
  <domain>-test-fixture.ts ← test-only helpers shared by colocated suites
  AGENTS.md             ← this file
```

### Test and evaluation files

`<domain>.test.ts` files are regular backend tests. `*.postgres-conformance.test.ts`
files are included in `yarn test:backend` and run against SQLite; `yarn
test:conformance` runs every backend file with that suffix against Postgres. Add
new backend conformance suites with this suffix so both commands discover them.
Other explicitly listed suites in `test:conformance` may use different names.

`*-test-fixture.ts` files hold test-only helpers and are not test suites. Keep
them beside the domain they support (or in `backend/test-helpers.ts` when shared
across domains). `*.live-eval.ts` files are manual evaluations, are not part of
either test suite, and may require `GEMINI_API_KEY`; document their run command
with the evaluation. All these TypeScript files are included in
`yarn typecheck:backend`.

The REST layer shares the service layer with `cli/` — do not duplicate business logic here. (See the temporary-deviation note above while that layer is still being built.)

SPA / DTO consumers:

```
webapp/
  web/                    ← React SPA (pure consumer of the rest surface)
  shared/contract.ts      ← re-exports @overlord/contract for SPA imports
packages/contract/        ← canonical typed DTO package (@overlord/contract)
```

---

## Cross-Module Checklist

- [ ] Read `contract/architecture.md` REST API Layer section
- [ ] DTO shapes derived from database logical schema (camelCase field names)
- [ ] New path/method → update `contract/architecture.md` REST API Layer section
- [ ] Breaking response change → bump contract version in `contract/components.yaml`
- [ ] Auth: resolve token → Actor via Auth Layer before any service call
- [ ] Persistence: service layer only, never direct table writes from route handlers
- [ ] Write-operations: use idempotency keys for client-retry safety
- [ ] REST extension → namespaced `/ext/<name>/` prefix + conformance manifest under `backend/ext/`
