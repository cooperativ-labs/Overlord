# Fully Local Overlord Plan

## Objective

Explore what it would take to offer a fully local Overlord mode for teams that cannot use the hosted cloud control plane.

## Executive Summary

Overlord already has some of the right seams for a local mode:

- Electron and CLI both support a configurable `OVERLORD_URL` and can target localhost.
- The local runtime writes connector metadata into `~/.ovld/runtime.*.json`.
- Protocol auth already supports a second local-only shared secret header, `X-Overlord-Local-Secret`.
- The model selector already supports file-based overrides via `agent-models.json`.

The hard part is not client routing. The hard part is that the current control plane is deeply tied to Supabase-backed services:

- Postgres data storage
- Supabase Auth / OAuth token exchange
- Supabase Storage for artifacts
- Realtime subscriptions
- Edge Functions for `sync-agent-models`, MCP, and `generate-feed-post`

If the goal is true cloud independence, a local option needs to replace or package that entire data plane, not just add a helper process in front of the existing app.

## Current State

### Already local-capable

- Electron launches agents against a configurable connector URL and already treats localhost as a first-class connector target.
- CLI credential resolution already prefers local runtime metadata and can attach the local secret header automatically.
- Protocol APIs are plain HTTP routes, which makes them portable to a local server process.
- `agent-models.json` already allows file-based model catalog overrides instead of database-only model discovery.

### Still cloud-coupled

- Protocol routes use a Supabase service-role client for ticket/session/event writes.
- Auth config and token exchange depend on Supabase OAuth and `agent_tokens`.
- Artifact upload/download paths depend on Supabase Storage signed URLs.
- Feed generation depends on the `generate-feed-post` Edge Function and Gemini API access.
- MCP handlers are implemented as Supabase Edge Functions.
- Feed, board, and ticket UI rely on Supabase-backed application data and realtime updates.

## Recommended Architecture

### Recommendation

Treat local Overlord as a packaged local control plane, not as a special case bolted onto the cloud product.

The cleanest parity-preserving shape is:

1. `overlord-local` helper service
2. desktop app and CLI both point to that local service
3. local service owns auth, database, artifacts, and background jobs
4. local mode keeps the same protocol/API contracts wherever possible

### Why this shape

- It preserves the existing Electron and CLI client model.
- It minimizes product forks by keeping API compatibility as the main boundary.
- It lets cloud and local share route handlers, schemas, protocol payloads, and UI behavior.
- It avoids pushing local-only branching deeply into every client surface.

## What The Local Helper Must Contain

### 1. Local application server

Package the current Next.js server as the local control plane entrypoint.

This already aligns with the packaged Electron app, which can run a standalone Next server. The missing step is making that server self-sufficient without hosted Supabase dependencies.

### 2. Local persistence layer

A true local mode needs a replacement for:

- `tickets`
- `ticket_events`
- `agent_sessions`
- `artifacts`
- `shared_state`
- `file_changes`
- `feed_posts`
- auth/membership tables used by org scoping and tokens

Recommended direction:

- keep Postgres semantics, not SQLite
- package a local Postgres instance or a tightly managed local database service

Reasoning:

- the current app, migrations, policies, and query shapes are heavily Postgres/Supabase-oriented
- replacing the backend with SQLite would create a parallel product and break parity over time
- local Postgres is operationally heavier, but far cheaper than rewriting the app around a different storage model

###+ 3. Local artifact storage

Artifacts currently assume Supabase Storage signed upload URLs. Local mode needs either:

- a local object store abstraction backed by the filesystem, or
- a small embedded S3-compatible service

Recommended direction:

- use filesystem-backed artifact storage under an app-owned data directory
- preserve the API shape conceptually, but return local upload URLs or local direct-write instructions

### 4. Local auth

The local mode should not require hosted login, but it still needs process-to-process trust.

Recommended auth model:

- first-run setup generates a local instance secret
- desktop stores it in OS secure storage
- CLI reads it from the existing `~/.ovld/runtime.*.json` metadata path with `0600` permissions
- protocol calls require:
  - bearer token representing a local profile or workspace principal
  - local secret header for loopback-only defense in depth

Pragmatic simplification:

- single-user local mode should be the first supported shape
- do not try to preserve multi-user hosted auth semantics in v1 local mode

This is simpler and matches the security-sensitive use case better than pretending a local workstation is a hosted org environment.

### 5. User-accessible agent model spec

This part is already partially implemented.

`agent-models.json` provides a file-based override layer over the database catalog. To make it a real local-mode feature:

- document it as the official local model catalog source
- add UI or settings import/export for editing it safely
- allow disabling provider sync entirely when a local catalog file is present
- decide whether the file is global, per-user, or per-workspace

Recommended v1:

- global per-instance file
- no sync job required in local mode

### 6. Feed generation replacement

The current feed path depends on the hosted `generate-feed-post` function and Gemini API key.

Recommended local-mode behavior:

- make feed optional
- if enabled, let the user choose:
  - disabled
  - manual/provider-backed summarization with their own API key
  - simple deterministic local summary mode with no external model

Recommended v1 default:

- feed disabled by default in local mode

This keeps the core ticket/protocol workflow available without forcing users to supply third-party API keys.

### 7. MCP surface

The current MCP implementation lives in Supabase Edge Functions. A local mode needs those handlers to run from the local helper instead.

Recommended direction:

- move MCP business logic behind shared server-side modules
- keep Edge Function wrappers for cloud if needed
- add a Node-hosted local wrapper for the same logic

Without this refactor, local mode will keep dragging Supabase Edge Functions along as an implementation dependency.

## Configuration Model

The configuration goal is straightforward and should stay that way.

Recommended settings:

- desktop:
  - `platform_url`
  - `connector_url`
  - local-mode enabled flag
- CLI:
  - `OVERLORD_URL`
  - `OVERLORD_CONNECTOR_URL`
  - local runtime discovery via `~/.ovld/runtime.*.json`

Recommended product behavior:

- if the desktop app launches the local helper, it should write the runtime file automatically
- the CLI should discover that runtime with no extra setup
- manual override via env vars must continue to work

## Parity Strategy

The main long-term risk is cloud/local drift.

To limit that:

1. keep protocol payloads and route contracts identical
2. keep local and cloud using the same Next route handlers where possible
3. isolate storage/auth/runtime differences behind adapters
4. treat local-only branches as infrastructure branches, not product branches
5. keep one migration stream for data models where possible

The wrong direction would be creating a separate local app with separate ticket logic, separate prompt generation, and separate feed/model behavior. That would drift quickly.

## Major Gaps To Close

### Workstream 1: Runtime packaging

- package a supported local server helper
- choose how it is installed, upgraded, and started
- define where database files, artifacts, and config live

### Workstream 2: Data plane extraction

- abstract current Supabase service-role usage
- provide local implementations for data, storage, and realtime needs
- ensure migrations can run locally in a controlled way

### Workstream 3: Auth simplification

- define single-user local identity
- generate and rotate local secrets
- remove hosted login as a hard dependency for local mode

### Workstream 4: MCP and background jobs

- move MCP handlers off Edge Function-only assumptions
- replace cron/scheduled jobs with local startup/interval tasks
- make feed/model sync optional or local-first

### Workstream 5: Product UX

- expose local mode in settings
- make the current connection target visible
- explain limitations clearly, especially for feed, auth, and multi-user support

## Problems And Risks Not In The Original Idea

### Local database lifecycle

- schema migrations now become end-user runtime concerns
- failed upgrades can strand a user on a broken local install
- backup/restore needs a real story

### Artifact growth

- local artifacts can grow indefinitely without retention and cleanup rules
- large uploads can exhaust disk space silently

### Realtime behavior

- cloud behavior currently benefits from Supabase realtime
- local mode needs either a replacement or a simpler polling fallback

### Multi-user ambiguity

- “local server” could mean single-user desktop-local or shared LAN server
- those are materially different security and support models
- v1 should explicitly target single-user local mode only

### Security on shared machines

- loopback-only assumptions break down on shared-user systems
- local secrets in files need strict permissions and rotation
- desktop, CLI, and helper trust boundaries need to be explicit

### API key handling

- if users bring their own provider keys for feed or model sync, local mode becomes responsible for storing and protecting them
- this raises OS keychain and export/import questions

### Background jobs and scheduling

- cron-like tasks do not exist automatically in a desktop-local deployment
- model refresh, cleanup, retention, and feed regeneration need a local scheduler

### Observability and support

- hosted logs and Sentry are much easier to inspect centrally
- local mode needs exportable diagnostics or support becomes difficult

### Packaging complexity

- shipping a local helper plus database plus migrations plus upgrades is materially more complex than shipping the current desktop shell

## Recommended Scope For V1

### In scope

- single-user local mode
- local helper service on loopback only
- local tickets/protocol/artifacts
- file-based model catalog
- feed disabled by default, optional provider-backed mode later

### Out of scope

- shared multi-user local server
- LAN exposure
- full parity for every hosted admin surface
- mandatory AI-generated feed posts
- cross-device sync

## Suggested Rollout

### Phase 1: Spike

- extract protocol/data/auth seams
- prove a local helper can serve desktop + CLI on loopback
- prove local artifact storage and ticket/session/event persistence

### Phase 2: Core local workflow

- attach/update/ask/deliver end to end
- local ticket board and artifact access
- file-based model catalog

### Phase 3: Optional enhancements

- local feed generation modes
- import/export and backup
- diagnostics bundle

## Bottom Line

This is feasible, but it is not a thin helper-only project.

The existing app already has good client-side seams for localhost routing, local runtime discovery, and local-secret hardening. The real project is packaging or replacing the hosted Supabase-backed control plane in a way that preserves API and behavior parity.

If the team wants the highest leverage path, the best v1 is:

- single-user only
- loopback-only helper
- local Postgres-backed control plane
- filesystem-backed artifacts
- documented `agent-models.json` as the official local model spec
- feed disabled by default

That keeps the first local release narrow enough to ship without creating a separate product.
