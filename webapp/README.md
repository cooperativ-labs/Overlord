# Web App Module

The web control center: a **Vite-powered React SPA** in `webapp/web/` over the
Express REST + realtime server in [`backend/`](../backend/AGENTS.md). Local
editions open SQLite under `OVLD_HOME`; hosted editions use Postgres. Typed DTOs
come from `@overlord/contract` (re-exported for the SPA via
`webapp/shared/contract.ts`).

A first slice has landed: a realtime console for **projects, missions, and
objectives** — list/create/edit each, with the UI reflecting database changes
(including writes made by the CLI) live over Server-Sent Events. The settings
surface covers per-user local execution-target launch defaults and per-source
project defaults (per-agent flags/pre-commands). Objective-specific edits are
stored with the objective and take precedence over both.

## Table of Contents

- [For Users](#for-users)
  - [Using the web app](#using-the-web-app)
  - [AI title summarization](#ai-title-summarization)
- [For Developers](#for-developers)
  - [Running the web app](#running-the-web-app)
  - [Module Layout](#module-layout)
  - [REST surface (as built)](#rest-surface-as-built)
  - [Contract Component](#contract-component)
  - [Documentation](#documentation)
  - [Status](#status)
  - [Code & Tests](#code--tests)

## For Users

### Using the web app

The web app runs as part of a backend process at the configured host/port. In
packaged local mode, Desktop supervises that backend. The current local default
is `http://127.0.0.1:4310`, which is also the CLI's default `backend_url`.

Open that URL in your browser to manage projects, missions, and objectives on a
realtime Kanban board. Changes made through the CLI appear live without a
manual refresh. The settings surface lets you configure per-user local
execution-target launch defaults (terminal profile plus per-agent flags and
pre-commands) and source-specific defaults under Project settings → Resources.

Terminal & IDE settings carry one **Session** choice per execution target —
`Direct` (the window runs the agent) or `Persistent` (Latch hosts the agent and
the window just shows it) — followed by the unchanged terminal picker, whose
label reads *Open in* or *Show it in* accordingly. The two are orthogonal:
Latch is never an entry in the terminal list, and the stored terminal choice is
untouched by toggling the provider. Latch availability is probed on the
execution target itself through the local-target `discoverLatch` capability and
rendered inline (version and path, the standalone install command when missing,
or the missing capability when incompatible); direct execution stays selectable
in every state, and Overlord never installs or upgrades Latch.

### AI title summarization

Mission and objective titles are derived from instruction text via the
[`automations`](../automations/README.md) module (`serviceToAutomations`):

- On create (and when an objective's instruction changes without an explicit
  title edit), the server sets an immediate local title, then asynchronously
  refines it with Gemini when `GEMINI_API_KEY` is set in the active env file.
- Title updates are written through the same `entity_changes` feed, so the
  board and mission panel refresh live.

## For Developers

### Running the web app

The module is a self-contained Yarn sub-project (its own `package.json`):

```bash
cd webapp
yarn install           # first time only
yarn dev               # server (:4310) + Vite dev server (:5173) together
# open http://localhost:5173
```

`yarn dev` runs the top-level backend (`../backend/index.ts`) and the Vite dev
server (which proxies `/api` to it). For a production-style run:

```bash
yarn build && yarn start   # builds the SPA, serves it + the API on :4310
```

The source server and Vite read repo-root `.env.local` only. Packaged/bundled
production reads `.env.prod` only. Copy `.env.local.example` for development ports
and `OVLD_HOME`. This lets a packaged production instance keep using
`OVERLORD_WEB_PORT=4310` while development runs on a different API port and
data directory.

The server opens the global SQLite database under `OVLD_HOME` by default
(override with `OVERLORD_SQLITE_PATH` or `overlord.toml` `database_path`).
Initialise that database first with `yarn start:local` from the repo root.

### Module Layout

```
webapp/
  web/                 ← the React SPA (pure consumer of the REST surface)
  shared/contract.ts   ← re-exports @overlord/contract for SPA imports
  docs/                ← design + planning specs (below)

backend/               ← the `rest` contract component (see backend/AGENTS.md)
  index.ts             ← Express app entry + route registration
  db.ts                ← DatabaseClient + entity_changes writer
  repository.ts        ← core per-resource reads/mutations
  realtime.ts          ← SSE emitter driven by the entity_changes feed
  ext/<name>/          ← namespaced /ext/<name>/ extension routers
  *.ts                 ← other domain modules (webhooks, organizations, …)

packages/contract/     ← canonical typed DTOs (@overlord/contract)
```

Realtime works off the `entity_changes` feed: every mutation appends a row in
the same transaction, and the server polls that feed (with a `PRAGMA
data_version` safety net for external table writes) and streams compact deltas
to the browser over `GET /realtime` (with `GET /api/stream` kept as a
compatibility alias), including `changedFields` parsed from
`changed_fields_json`, which the SPA maps to targeted TanStack Query
invalidations. Reconnects replay `GET /sync/changes?after=<seq>` and fall back
to full-cache invalidation if catch-up is unavailable.

### REST surface (as built)

All under an `/api` prefix so the SPA can own the root path-space. DTO fields are
camelCase per the [REST API Boundary](../database/docs/09-database-schema-contract.md#rest-api-boundary).

| Method & path | Purpose |
| --- | --- |
| `GET /api/meta` | Active organization, organizations list, accessible workspaces in that organization, nullable default workspace, and capability flags |
| `POST /api/onboarding` | Zero-membership onboarding: creates an organization, first workspace, membership, and admin role in one transaction |
| `GET/PATCH /api/organizations/:id` | Organization identity and settings, including name and logo |
| `GET/POST/DELETE /api/organizations/:id/admins` | Derived organization admin management (`ADMIN` in every constituent workspace) |
| `GET /realtime` | Canonical SSE realtime feed of `entity_changes` deltas |
| `GET /api/stream` | Compatibility alias for the SSE realtime feed |
| `GET /sync/changes?after=<seq>` | Reconnect catch-up read backed by `entity_changes` |
| `GET /api/agent-catalog`, `PUT /api/agent-catalog`, `POST /api/agent-catalog/refresh` | Workspace agent catalog for launch/settings surfaces |
| `GET /api/launch-settings` | The acting user's local execution-target launch defaults |
| `PATCH /api/launch-settings/agents/:agentKey` | Persist per-agent pre-command / flags to `user_execution_target_preferences.agent_configs_json` |
| `PATCH /api/launch-settings/terminal-profile` | Persist the local terminal launcher profile to `user_execution_target_preferences.terminal_profile_json` |
| `PATCH /api/launch-settings/session-defaults` | Persist the user-level execution-provider / viewer default new execution targets inherit |
| `PATCH /api/projects/:id/resources/:resourceId/sources/:sourceId` | Replace per-agent pre-command / flag defaults on one project resource source |
| `GET/POST /api/projects`, `GET/PATCH /api/projects/:id` | Projects (PATCH covers rename / describe / archive) |
| `GET /api/workspaces/:id/project-statuses` | Aggregate project-status read for a workspace |
| `GET/POST /api/projects/:id/statuses` | Read or add project-owned board statuses |
| `PATCH/DELETE /api/projects/:id/statuses/:statusId` | Update or soft-delete a project status |
| `PATCH /api/projects/:id/statuses/reorder` | Reorder a project's statuses |
| `GET /api/projects/:id/resources` | Linked project resources, including execution-target-specific working directories |
| `POST /api/projects/:id/resources` | Add a linked project resource for an execution target |
| `PATCH /api/projects/:id/resources/:resourceId` | Set a project resource as primary |
| `DELETE /api/projects/:id/resources/:resourceId` | Remove a linked project resource |
| `GET /api/projects/:id/repository?executionTargetId=...` | Git repository metadata and file tree for the selected linked resource |
| `GET /api/projects/:id/missions` | Missions in a project (`?includeObjectives=1` embeds each mission's objectives in one batched read) |
| `POST /api/missions`, `GET/PATCH/DELETE /api/missions/:id` | Missions (DELETE soft-deletes mission + objectives) |
| `GET /api/missions/:id/objectives` | Objectives of a mission |
| `POST /api/objectives`, `PATCH/DELETE /api/objectives/:id` | Objectives |

The SPA uses the authenticated project-status REST surface above; status names,
order, and defaults are defined by each project, while status types provide the
shared lifecycle vocabulary for cross-project views.

### Contract Component

The SPA consumes the **REST API Layer** (`rest`) owned by
[`backend/`](../backend/AGENTS.md) / [`CONTRACT.md`](../CONTRACT.md), which owns:

- URL paths and HTTP method contracts
- Request/response DTO shapes (derived from the logical schema's camelCase field names)
- REST auth integration points (via the [Auth module](../auth/README.md))
- The SSE/WebSocket realtime endpoint

It does **not** own the database schema (→ [Database module](../database/README.md))
or the protocol CLI surface (→ [CLI module](../cli/README.md)).

### Documentation

- [Web App Requirements](docs/web-app.md): deferred UI / control-center requirements, kept separate from the CLI-first implementation.
- [Framework Recommendation](docs/framework-recommendation.md): why the first implementation should prefer Vite + React + TanStack Router/Query + Serwist over Next.js.
- [UI Design Documents](docs/ui/README.md): the detailed design specification for the realtime React interface — a structure/information-architecture document followed by one detailed spec per page (projects, board, mission detail, execution/runner, review, changes, connectors, settings, users/tokens, search).
- [Implementation Plan](docs/implementation-plan.md): the dependency-ordered build plan that turns the framework recommendation and UI design docs into phased milestones (contract-first API, realtime spine first, vertical slice, then breadth, then gated surfaces).
- REST API Boundary: see the "REST API Boundary" section of [09 — Database Schema Contract](../database/docs/09-database-schema-contract.md) (owned by the [Database module](../database/README.md)).
- [Test Plan](docs/testing.md): REST API conformance (routing, camelCase DTO shape, auth/authorization, idempotency, realtime/sync) plus the framework-agnostic web-UI test plan. Part of the root [TEST_PLAN.md](../TEST_PLAN.md).

### Status

A first realtime slice has landed (projects / missions / objectives CRUD +
live updates). The remaining surfaces described in the [UI design
docs](docs/ui/README.md) and [implementation plan](docs/implementation-plan.md)
— execution & runner, review & delivery, current changes, connectors, settings,
users/roles/tokens — are still deferred and remain CLI-only.

> **Scope note for this slice:** some `backend/` paths still read and write the
> database directly rather than calling the shared service layer in
> `packages/core/service/`. Move those REST handlers onto the service layer as
> the areas are touched per [`backend/AGENTS.md`](../backend/AGENTS.md), so
> business logic is not duplicated.

### Code & Tests

- `../backend/` — Express REST + SSE realtime (`db.ts`, `repository.ts`,
  `realtime.ts`, `index.ts`, plus domain modules and `ext/`). Agent extension
  guide: [`backend/AGENTS.md`](../backend/AGENTS.md).
- `web/` — the React SPA (`main.tsx`, `router.tsx`, `lib/`, `components/`, `pages/`).
- `shared/contract.ts` — re-exports `@overlord/contract` for SPA imports.

`yarn typecheck` and `yarn build:prod` both pass. The realtime path is verified
end-to-end (a write from a separate process is reflected in the UI without a
reload).
