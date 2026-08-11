# Backend Module — Agent Extension Guide

This file tells agents how to extend the **REST API Layer** (`rest`) — the Express REST + SSE realtime server that lives in `backend/`. Read [`CONTRACT.md`](../CONTRACT.md) and the [component-contract skill](../.claude/skills/component-contract/SKILL.md) before making any cross-module change.

The React SPA that consumes this surface lives in [`webapp/`](../webapp/AGENTS.md). Typed DTOs live in `@overlord/contract` (`packages/contract/`); `webapp/shared/contract.ts` is a re-export shim for SPA imports.

> **Temporary deviation:** some landed `backend/` paths still read/write SQLite/Postgres tables directly instead of going through the shared service layer in `packages/core/service/`. The rule below (REST handlers call the service layer, never tables directly) still holds — move direct-table writers onto the shared service layer as those areas are touched. Do not add new direct-table writers without recording the same caveat.

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

1. Read `CONTRACT.md` — REST API Layer section (stable id: `rest`).
2. Read the "REST API Boundary" section of [`database/docs/09-database-schema-contract.md`](../database/docs/09-database-schema-contract.md) — it defines the DTO shape contract (camelCase field names derived from the logical schema).
3. Confirm the endpoint follows the shared **service layer** pattern: REST handlers must never write to database tables directly — they call the same service layer as the CLI and protocol surfaces.
4. Prefer matching an existing domain module's shape (`backend/webhooks.ts`, `backend/organizations.ts`, `backend/ext/github/`) over inventing a new directory layout.

---

## Adding a New REST Endpoint

REST endpoints are stable interfaces. URL paths and HTTP method contracts, once shipped, require a contract update to change.

**Steps:**

1. **Confirm the DTO shape** against `database/docs/09-database-schema-contract.md`. Response field names are camelCase versions of the logical schema column names. Add or extend types in `@overlord/contract` (`packages/contract/`) when the response is new.
2. **Update `CONTRACT.md`** REST API Layer section with the new path, method, and response shape.
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
2. **Update `database/docs/09-database-schema-contract.md`** if the event type derives from `entity_changes` — note it in the "Realtime/Sync" section.
3. **Implement via `backend/realtime.ts`** (and the `recordChange` helpers in `backend/db.ts`). Events must be derived from `entity_changes` rows written in the same transaction as the domain mutation — never computed separately. Canonical stream: `GET /realtime`; catch-up: `GET /sync/changes?after=<seq>`.
4. **Document the event shape** (type, payload fields) in `CONTRACT.md` REST API Layer section.

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
  <domain>.ts           ← top-level domain modules (webhooks, organizations, …)
  <domain>.test.ts      ← colocated tests
  http/                 ← request helpers (meta, origins, SPA serving, device hints)
  execution/            ← runner / launch / local-target helpers
  branching/            ← branch observations and related routes
  ext/
    <name>/             ← namespaced extension routes
      routes.ts
      service.ts
      conformance-manifest.yaml
  AGENTS.md             ← this file
```

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

- [ ] Read `CONTRACT.md` REST API Layer section
- [ ] DTO shapes derived from database logical schema (camelCase field names)
- [ ] New path/method → update `CONTRACT.md` REST API Layer section
- [ ] Breaking response change → bump contract version in `contract/components.yaml`
- [ ] Auth: resolve token → Actor via Auth Layer before any service call
- [ ] Persistence: service layer only, never direct table writes from route handlers
- [ ] Write-operations: use idempotency keys for client-retry safety
- [ ] REST extension → namespaced `/ext/<name>/` prefix + conformance manifest under `backend/ext/`
