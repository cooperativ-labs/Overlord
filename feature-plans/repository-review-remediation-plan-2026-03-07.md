# Engineering Plan: Repository Review Remediation

**Source:** Whole-repository review completed on 2026-03-07
**Date:** 2026-03-07
**Status:** Planning

---

## Objective

Address the highest-risk issues identified in the repository review:

1. Remove unsafe secret handling from the Electron production build path.
2. Repair the broken test/tooling baseline.
3. Fix the Everhour time-entry regressions and incomplete task-id wiring.
4. Tighten verification so the same classes of issues fail earlier in CI.

## Executive Decision

### Do we need to embed `SUPABASE_SECRET_KEY`?

For the shipped Electron application: **no**.

The Supabase service-role or secret key is a server credential. Embedding it into a packaged desktop app is not meaningfully safe, even if it is only consumed from the Electron main process:

- The value is still present in the distributable or in process memory on an untrusted client machine.
- A packaged Electron app should be treated as user-controllable.
- Any compromise would expose full backend privileges, bypassing RLS and normal per-user authorization.

### If we absolutely had to embed it, is there a safe way?

For a distributed client binary: **effectively no**.

There are safer alternatives, but they are all variations of "do not ship the global secret to the client":

- Use a hosted API route or Edge Function that runs with server-side credentials.
- Use short-lived, user-scoped tokens issued after interactive auth.
- Use signed URLs or one-time server-issued capabilities for narrow operations.
- Keep release/build secrets in CI or local release tooling only, never in the app artifact.

The only acceptable place for `SUPABASE_SECRET_KEY` is:

- server-side runtime on trusted infrastructure
- local release tooling on a trusted maintainer machine
- CI/CD secrets used during packaging or upload

It should not be embedded into `electron/_prod-env.generated.ts`, the renderer bundle, or any packaged runtime asset.

---

## Current State

### Secret handling

- `scripts/electron-build.mjs` reads `.env.prod` and serializes all values into `electron/_prod-env.generated.ts`.
- `electron/main.ts` loads the generated module and applies those values into `process.env` on packaged runs.
- The generated file is gitignored, but the packaging behavior still places those values in the distributable.

### Test/tooling baseline

- `package.json` declares Jest-based scripts.
- Jest is not installed.
- `tsconfig.json` includes TS test files in the primary typecheck.
- At least one TS test file uses Jest globals without the matching type definitions.

### Everhour

- `createTimeRecordForTicket()` no longer provisions a missing Everhour task before creating the first manual entry.
- `EverhourNavTimer` derives `everhourTaskId` but does not pass it to `TimeEntriesPanel`.
- `TimeEntriesPanel` omits `everhourTaskId` from a hook dependency list and currently fails lint.

---

## Workstreams

## Workstream 1: Secret Handling and Electron Packaging

**Goal:** ensure the packaged app contains only public or low-sensitivity runtime config, and move privileged operations back to trusted infrastructure or release-time tooling.

### 1.1 Classify environment variables by trust boundary

Create an explicit env classification table and enforce it in code:

| Class | Examples | Allowed in shipped app |
|---|---|---|
| Public client config | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, publishable key, OAuth client IDs | Yes |
| Desktop runtime non-secret config | `OVERLORD_TIMEOUT`, local redirect URIs | Yes, if truly needed |
| Release-time secrets | Apple notarization secrets, upload credentials, Resend server key | No |
| Backend privileged secrets | `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | No |

Deliverable:
- a small documented whitelist, not a blacklist

### 1.2 Replace "serialize everything from `.env.prod`" with explicit whitelisting

Refactor `scripts/electron-build.mjs` and any related generator so they only emit a fixed allowlist such as:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_OVERLORD_MCP_URL`
- `SUPABASE_OAUTH_CLI_REDIRECT_URI`
- `SUPABASE_OAUTH_ELECTRON_REDIRECT_URI`
- `SUPABASE_OAUTH_CLI_CLIENT_ID`
- `SUPABASE_OAUTH_ELECTRON_CLIENT_ID`
- `OVERLORD_TIMEOUT` if still required at runtime

Explicitly exclude:

- `SUPABASE_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND`
- `APPLE_APP_SPECIFIC_PASSWORD`
- any release upload or signing credential

### 1.3 Separate build-time inputs from shipped runtime inputs

Split the current `.env.prod` usage into two conceptual inputs:

1. `public build/runtime config`
2. `release-only secrets`

Implementation options:

- Preferred: introduce `electron.runtime.env` generation from a strict allowlist and keep sensitive values only in CI shell env or local release shell env.
- Acceptable: keep `.env.prod`, but only read selected keys for the generated runtime file and keep the rest in process env for packaging commands without serializing them.

### 1.4 Audit runtime codepaths that assume direct privileged credentials

Review app features that may have motivated bundling the secret:

- download/upload flows
- release upload scripts
- service-role client creation
- any desktop-only operations

For each privileged use case, choose one of:

- hosted API route with server auth
- Supabase Edge Function with server secret on the backend
- signed URL / one-time token
- scoped user credential after browser auth

### 1.5 Add automated leakage prevention

Add CI checks that fail if:

- generated Electron runtime files contain known secret prefixes like `sb_secret_`
- allowlist violations appear in generated runtime config
- release secrets are referenced from renderer code or packaged runtime code

Potential checks:

- a small script that scans generated env files
- a grep-based CI job for forbidden keys in `electron/_prod-env.generated.ts`
- unit test over the env allowlist generator

### 1.6 Acceptance criteria

- The packaged Electron artifact contains no service-role or other server secrets.
- Release tooling still works with CI-provided secrets.
- Desktop runtime features continue to function using only public config and backend-mediated privileged actions.

---

## Workstream 2: Test and Tooling Baseline

**Goal:** restore a truthful engineering baseline where `yarn test`, `yarn type-check`, and `yarn lint` represent the actual repository state.

This workstream has its own detailed implementation plan in:

`feature-plans/jest-testing-implementation-plan-2026-03-07.md`

High-level requirement:

- choose one primary JS/TS test runner strategy and make scripts, installed packages, TS config, and existing tests agree on it

Immediate priority:

- fix the current broken contract where Jest scripts exist but Jest is not installed

---

## Workstream 3: Everhour Regressions

**Goal:** restore the original time-entry behavior and complete the new task-id support cleanly.

### 3.1 Restore task provisioning for first manual entry

In `createTimeRecordForTicket()`:

- if `ticketId` is present and no stored `everhour_task_id` exists, call `ensureEverhourTaskForTicket(ticketId)`
- preserve the new optional `everhourTaskId` path only for flows that already have a task reference

Recommended rule:

- `ticketId` path owns task provisioning
- `everhourTaskId` path assumes the task already exists

### 3.2 Complete the nav timer task-id wiring

In `EverhourNavTimer`:

- decide which contexts should show time entries while a timer is active
- if the intended behavior is "show entries for the active timer even without ticket context", pass both `ticketId` and `everhourTaskId`
- if that behavior is not desired, remove the dead `everhourTaskId` extraction and simplify the component

The current in-between state should not remain.

### 3.3 Fix stale hook dependencies and formatting

In `TimeEntriesPanel`:

- include `everhourTaskId` in the `loadEntries` dependency list
- rerun lint/formatting after the functional fix
- verify that task changes trigger a reload rather than leaving stale records on screen

### 3.4 Add regression coverage

Add tests for:

- creating the first manual entry on a ticket with no existing Everhour task
- listing entries via `everhourTaskId` only
- nav timer rendering behavior with and without ticket context
- panel reload when the active task changes

### 3.5 Acceptance criteria

- Manual entry creation works for untouched tickets.
- The nav timer behavior is explicit and fully wired.
- `TimeEntriesPanel` passes lint and updates correctly when task context changes.

---

## Workstream 4: CI and Quality Gates

**Goal:** make these failures visible before release instead of during review.

### 4.1 Make the core checks mandatory

Target baseline:

- `yarn lint`
- `yarn type-check`
- `yarn test`

All three should run in CI for pull requests and release builds.

### 4.2 Reduce warning noise where it hides real defects

The current lint output contains many non-blocking warnings. That makes it easier to miss real issues such as:

- hook dependency bugs
- generated env leakage
- dead code hiding incomplete integrations

Recommended approach:

- fix the current warning backlog in a dedicated cleanup pass
- then decide whether selected warnings should become errors in CI

### 4.3 Add targeted security checks

Add at least one CI step for:

- forbidden secret prefixes in source and generated runtime artifacts
- no tracked generated production env file
- verification that Electron runtime config generation uses a whitelist

---

## Delivery Sequence

## Phase 0: Immediate containment

1. Remove any committed/generated secret-bearing runtime files from active release artifacts.
2. Rotate exposed credentials if any of the currently embedded values have been used outside a trusted environment.
3. Pause any release flow that still packages privileged secrets.

## Phase 1: Packaging hardening

1. Refactor Electron runtime env generation to a whitelist model.
2. Move release-only secrets back to CI/local packaging env.
3. Add leakage checks.

## Phase 2: Testing baseline

1. Implement the separate Jest/testing plan.
2. Make local and CI commands truthful again.

## Phase 3: Everhour fixes

1. Restore task provisioning.
2. Complete or remove task-id-only nav timer support.
3. Add regression coverage.

## Phase 4: CI enforcement

1. Require lint, type-check, and test in PRs.
2. Add security/config checks for Electron packaging.

---

## Risks and Mitigations

### Risk: release workflow depends on secrets currently bundled into the app

Mitigation:

- inventory each secret-consuming step
- preserve secret availability for packaging commands without serializing secrets into runtime files

### Risk: switching test tooling causes churn across existing tests

Mitigation:

- keep the first pass focused on restoring a working baseline
- only migrate tests after the runner contract is stable

### Risk: Everhour fixes reintroduce duplicate task creation

Mitigation:

- treat ticket-based provisioning as the single authoritative path
- test both "existing task" and "no task yet" cases

---

## Recommended Ownership

- Packaging/security: Electron + platform owner
- Testing baseline: frontend/platform owner
- Everhour regressions: Everhour feature owner
- CI hardening: platform owner

## Recommended Definition of Done

- No privileged backend secret is present in any shipped Electron artifact.
- `yarn lint`, `yarn type-check`, and `yarn test` all pass in a clean checkout.
- Everhour manual entry and task-id flows have regression coverage.
- CI blocks future reintroduction of these classes of issues.
