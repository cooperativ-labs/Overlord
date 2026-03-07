# Engineering Plan: Thin Wrapper Migration

**Source:** Repository review remediation, Electron architecture investigation, packaging docs
**Date:** 2026-03-07
**Status:** Planning

---

## Objective

Migrate Overlord Electron production from the current packaged-local-backend architecture to a true thin-wrapper architecture.

This plan explicitly includes the first objective from the remediation plan:

**Remove unsafe secret handling from the Electron production build path.**

The target state is:

- Electron production loads the hosted Overlord web app directly.
- Electron provides local-only integrations such as PTY, notifications, deep links, and launcher helpers.
- All privileged Supabase operations run on trusted hosted infrastructure, not in the desktop app.
- No `SUPABASE_SECRET_KEY` or equivalent server credential is embedded in the shipped Electron artifact.

---

## Executive Summary

### Current production architecture

The packaged Electron app is not currently a thin wrapper. It behaves like a local backend host:

- `electron/main.ts` loads baked-in env vars into `process.env`
- `electron/services/next-server.ts` starts the packaged standalone Next.js server
- Electron loads `http://localhost:<port>`
- local API routes use `createServiceRoleClient()`
- `createServiceRoleClient()` depends on `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`

This is why a backend-grade credential is currently embedded into the app.

### Target architecture

Production Electron should instead:

- load the hosted Overlord URL directly
- stop starting the packaged standalone Next.js server
- stop embedding service-role credentials
- keep only local integration code in Electron
- route all auth and protocol traffic to hosted Overlord

### Core migration principle

**Electron should call the backend, not ship the backend.**

---

## Current State

## Electron runtime

- Production env values are serialized from `.env.prod` into `electron/_prod-env.generated.ts`
- `electron/main.ts` applies those values for packaged runs
- Electron starts the packaged Next standalone server and loads `localhost`

## Privileged server behavior currently executing inside the packaged app

- protocol auth and token validation
- protocol read/write operations
- device-code auth request/poll flows
- OAuth token exchange to agent tokens
- onboarding token creation
- any route that uses `createServiceRoleClient()`

## Release tooling

- Electron release upload scripts use Supabase Storage with a service-role credential

This release-tooling use is acceptable in CI or maintainer environments. It is not a reason to ship the secret inside Electron runtime.

---

## Migration Goals

1. Remove `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from shipped Electron runtime.
2. Stop starting a packaged local Next.js server in production Electron.
3. Preserve all user-visible auth and protocol workflows through hosted backend routes.
4. Keep Electron-specific local capabilities through IPC.
5. Retain a usable local dev mode for engineers.

---

## Non-Goals

- Rewriting the entire protocol API surface
- Replacing Supabase Cloud as system of record
- Providing full offline support
- Removing all server-side secrets from CI or release tooling
- Solving all testing or Everhour issues in the same migration

---

## Architecture Delta

## Today

```text
Electron
  -> injects baked env
  -> starts local packaged Next server
  -> browser window loads localhost
  -> local Next routes call Supabase service-role client
  -> local app behaves as privileged backend
```

## Target

```text
Electron
  -> loads hosted Overlord URL
  -> exposes local IPC only

Hosted Overlord (Next.js / Supabase Cloud)
  -> owns auth flows
  -> owns protocol routes
  -> owns service-role operations
  -> owns artifact signing / privileged data operations
```

---

## Workstreams

## Workstream 1: Remove Unsafe Secret Handling From Electron Production Build Path

**Priority:** P0

### Goal

Ensure no privileged backend credential is embedded in the shipped Electron runtime.

### Required changes

#### 1.1 Replace current "serialize all env vars" behavior with an allowlist

Current problem:

- `scripts/electron-build.mjs` reads all of `.env.prod`
- all values are written into `electron/_prod-env.generated.ts`

Required change:

- create an explicit runtime env allowlist for Electron
- only include public or low-sensitivity runtime config

Allowed examples:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_OVERLORD_MCP_URL`
- `SUPABASE_OAUTH_CLI_REDIRECT_URI`
- `SUPABASE_OAUTH_ELECTRON_REDIRECT_URI`
- `SUPABASE_OAUTH_CLI_CLIENT_ID`
- `SUPABASE_OAUTH_ELECTRON_CLIENT_ID`
- `OVERLORD_TIMEOUT` only if still required

Explicitly forbidden in shipped runtime:

- `SUPABASE_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND`
- Apple notarization credentials
- any release upload secret

#### 1.2 Separate build/runtime config from release-only secrets

Introduce two classes of environment input:

1. Electron runtime config
2. release-tooling secrets

Recommended implementation:

- `scripts/electron-build.mjs` generates runtime config from an allowlist
- `scripts/upload-electron-release.mjs` continues to read service-role secrets from CI env or maintainer env
- release secrets are never written into generated runtime TS files

#### 1.3 Add leakage prevention

Add CI guards that fail on:

- secret prefixes such as `sb_secret_` inside generated runtime files
- disallowed keys inside generated Electron env output
- accidental tracking of generated runtime env files

### Acceptance criteria

- no service-role credential exists in Electron runtime files or packaged artifacts
- Electron packaging still works
- release upload still works from trusted environments

---

## Workstream 2: Stop Running Packaged Next.js Server In Production Electron

**Priority:** P0

### Goal

Remove the local packaged web backend from production Electron.

### Required changes

#### 2.1 Split Electron dev mode from production mode cleanly

Keep:

- development Electron loading local Next dev server for developer convenience

Remove from production:

- `startNextServer()` in packaged runs
- any requirement that production Electron host the web app locally

#### 2.2 Change production window boot flow

Production Electron should:

- resolve the hosted platform URL
- load that URL directly in `BrowserWindow`
- no longer compute or persist a local Next server port in packaged runs

#### 2.3 Keep local-only integrations in Electron

Electron should continue to own:

- PTY / terminal IPC
- notifications
- deep links
- launch helpers
- secure local credential storage if needed

### Acceptance criteria

- packaged Electron launches without starting a local Next server
- browser window points to hosted Overlord
- Electron-only integrations still work

---

## Workstream 3: Migrate Auth Flows To Hosted Ownership

**Priority:** P0

### Goal

Move all local auth flows that currently depend on the packaged backend to hosted backend routes and user-scoped flows.

### Auth flows to address

#### 3.1 Device-code / browser approval flow

Current behavior:

- local packaged route creates device code
- hosted-looking browser UI may still be served from local app depending on runtime
- local packaged route polls and issues access token

Target behavior:

- local CLI or Electron calls hosted auth-grant endpoints
- browser approval UI runs on hosted Overlord
- polling/exchange happens against hosted Overlord only

Implementation direction:

- standardize on the newer `auth_grants` model
- keep compatibility wrappers if needed during cutover

#### 3.2 OAuth token exchange flow

Current behavior:

- `/api/auth/token` verifies Supabase JWT and mints/reuses `agent_tokens`
- this currently depends on service-role access

Target behavior:

- hosted route only
- called by CLI or Electron local client after browser auth completes
- no local packaged backend involved

#### 3.3 Onboarding token creation

Current behavior:

- onboarding auto-creates a default CLI token via service-role client

Target behavior:

- either remove automatic token creation
- or replace it with an explicit hosted "create local client token" flow after onboarding

Recommendation:

- remove implicit token creation and make local-client authorization explicit

#### 3.4 Token storage

Electron local storage responsibilities remain local:

- store user-scoped client credential locally
- prefer secure OS-backed storage if available

Hosted responsibilities:

- issue
- validate
- revoke
- audit

### Which auth pieces can use user-scoped flows

Likely candidates:

- viewing current-user memberships
- creating current-user-owned agent tokens
- revoking current-user tokens

These should use authenticated user context and RLS-safe queries where possible rather than service role.

### Which auth pieces remain hosted privileged routes

- grant creation
- grant polling / one-time code consumption
- token exchange validation
- audit logging
- any anti-abuse or replay protection

### Acceptance criteria

- Electron and CLI auth work without a local packaged backend
- browser approval flow always runs on hosted Overlord
- no auth route in production Electron requires service-role credentials

---

## Workstream 4: Migrate Protocol Flows To Hosted Ownership

**Priority:** P0

### Goal

Ensure all agent protocol operations run only against hosted Overlord.

### Protocol flows to migrate

- attach
- update
- ask
- deliver
- read-context
- write-context
- list-tickets
- create-ticket
- ticket context fetch
- artifact prepare/finalize/download URL flows

### Required changes

#### 4.1 Make hosted routes the only production route target

The CLI and any Electron-assisted local clients must call hosted `/api/protocol/*`.

No production logic should depend on:

- local packaged `localhost` protocol routes
- local service-role Supabase access

#### 4.2 Preserve local launcher ergonomics

Electron can still assist with:

- generating launch commands
- pre-filling `OVERLORD_URL`, `AGENT_TOKEN`, `TICKET_ID`
- opening terminals

But the actual protocol traffic must go to hosted Overlord.

#### 4.3 Revisit local secret header usage

If `OVERLORD_LOCAL_SECRET` is only protecting local packaged routes, it may become unnecessary once protocol traffic is hosted.

Required action:

- audit all callers of the local-secret header
- remove it if it no longer protects anything meaningful
- keep only if there is still a localhost-only local IPC-facing HTTP surface

### Acceptance criteria

- agent protocol flows work against hosted backend only
- packaged Electron no longer relies on local protocol HTTP routes

---

## Workstream 5: Decide Route Ownership Between Hosted Next Routes, Edge Functions, and User-Scoped Flows

**Priority:** P1

### Goal

Assign each current privileged behavior to the correct ownership model.

## Hosted Next routes

Use hosted Next API routes for:

- protocol endpoints
- auth-grant initiation/poll/exchange
- token validation and token lifecycle operations
- ticket context generation
- follow-up ticket creation
- artifact metadata writes

Why:

- easiest migration path from existing code
- current implementation already exists in Next routes
- keeps business logic in one place

## User-scoped flows

Use normal authenticated user flows for:

- current-user token management UI
- current-user token creation where RLS permits it
- membership lookup for current user
- onboarding continuation after login

Why:

- reduces service-role usage
- aligns with current RLS policy surface

## Edge Functions

Use Edge Functions only where they add clear value:

- signed storage URL generation if you want logic close to Supabase Storage
- artifact upload/download mediation
- isolated privileged helpers that are mostly database/storage orchestration

Recommendation:

- do not move core migration work to Edge Functions unless a concrete need appears
- migrate to hosted Next routes first, then selectively extract later

---

## Workstream 6: Electron Runtime Surface After Migration

**Priority:** P1

### Goal

Define what Electron still does once it becomes thin.

### Electron-owned responsibilities

- BrowserWindow lifecycle
- deep links
- PTY session management
- OS notifications
- launcher helpers
- local credential storage
- app auto-update
- opening external auth windows if needed

### Electron responsibilities to remove

- hosting production web UI locally
- executing privileged Supabase routes locally
- carrying service-role credentials
- acting as a local auth/protocol backend

---

## Workstream 7: Performance and Reliability Adjustments

**Priority:** P1

### Goal

Handle the tradeoffs introduced by moving from localhost backend calls to hosted backend calls.

### Expected regressions

- increased request latency
- more network sensitivity
- less tolerance of offline conditions

### Required mitigations

- cache lightweight static/config endpoints where appropriate
- show clearer network/auth failure states in Electron
- keep realtime subscriptions robust
- make CLI/auth retries user-friendly
- prefetch or batch ticket context data where possible

### Optional mitigations

- region-aware deployment choices
- route-level caching for read-heavy endpoints
- explicit offline messaging in Electron shell

---

## Workstream 8: Rollout Strategy

**Priority:** P0

### Phase 0: Containment

1. Stop embedding service-role credentials into generated Electron runtime files.
2. Rotate any secrets that have already shipped if warranted.
3. Gate future Electron release builds on leakage checks.

### Phase 1: Hosted route readiness

1. Confirm all auth/protocol flows work in hosted environment independent of local Electron backend.
2. Fill any hosted route gaps.
3. Validate local client auth against hosted routes only.

### Phase 2: Production Electron cutover

1. Add production-only path that loads hosted URL directly.
2. Keep dev mode loading localhost.
3. Disable packaged local Next server startup in production builds.

### Phase 3: Electron cleanup

1. Remove dead local-backend codepaths from production startup.
2. remove unused local-secret protections if obsolete
3. shrink runtime env surface to public config only

### Phase 4: Hardening

1. add CI gates
2. add smoke tests for Electron auth and protocol launch flows
3. document the architecture and local dev workflow

---

## Implementation Backlog

## Backend

- inventory all routes that use `createServiceRoleClient()`
- classify each route as hosted-only, user-scoped, or extractable helper
- finish migration from `device_auth_codes` to `auth_grants` if not complete
- add any missing hosted endpoints needed by Electron and CLI

## Electron

- refactor startup so packaged builds load hosted URL
- preserve localhost dev boot only in dev mode
- remove production dependency on local Next standalone server
- reduce runtime env generation to allowlisted public config

## CLI / local clients

- ensure all auth and protocol requests point to hosted Overlord
- validate resume/attach/update flows against hosted routes
- ensure local client credential storage remains compatible

## Security / release

- split runtime env generation from release secret loading
- keep upload scripts using CI/local env only
- add leakage detection to CI

## Docs

- update packaging docs
- document auth ownership and route ownership
- document Electron prod vs dev boot behavior

---

## Risks and Mitigations

### Risk: hosted auth/protocol flow gaps appear only after local backend is removed

Mitigation:

- make hosted-only smoke checks pass before disabling packaged localhost backend

### Risk: Electron loses features that accidentally depended on local routes

Mitigation:

- inventory all `fetch('/api/...')` assumptions from Electron-rendered UI
- test top user journeys in hosted mode before cleanup

### Risk: user-perceived latency increases

Mitigation:

- focus on request reduction and UX feedback, not on preserving localhost semantics

### Risk: secret-removal breaks release tooling

Mitigation:

- isolate release tooling env from runtime env rather than removing secret use everywhere

---

## Acceptance Criteria

- Production Electron does not start a packaged Next.js server.
- Production Electron does not contain `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`.
- Auth flows for CLI and Electron complete entirely against hosted Overlord.
- Agent protocol flows run entirely against hosted Overlord.
- Electron local integrations still work.
- Developer workflow still supports localhost-based development Electron mode.

---

## Recommended Execution Order

1. Remove unsafe secret handling from Electron runtime build path.
2. Make hosted auth and protocol flows complete and production-ready.
3. Switch packaged Electron to hosted URL loading.
4. Remove production local-backend startup.
5. Clean up obsolete local-secret and local-route assumptions.
6. Add CI and smoke-test enforcement.

---

## Handoff Notes For The Implementation Agent

When executing this migration, treat the following as architectural facts:

- release-tooling use of a service-role key is acceptable in trusted environments
- runtime use of a service-role key inside the shipped Electron app is not acceptable
- hosted Next routes are the default migration target
- Edge Functions are optional and should be justified case by case
- dev Electron may still load localhost, but packaged production Electron must not

The success condition is not merely "Electron still works." The success condition is:

**Electron works as a thin wrapper without shipping backend trust.**
