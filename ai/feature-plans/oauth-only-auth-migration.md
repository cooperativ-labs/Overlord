# OAuth-Only Auth Migration For MCP, Desktop, And CLI

## Objective

Remove `AGENT_TOKEN` as the normal auth mechanism and move MCP, Desktop, and CLI onto OAuth-issued Supabase tokens only.

The end state is:

- protocol and MCP accept OAuth bearer JWTs with explicit org scope
- Desktop and CLI share one OAuth credential record in `~/.ovld`
- CLI refreshes short-lived access JWTs from a stored OAuth refresh token
- Desktop login automatically enables CLI access
- `ovld auth login` remains a first-class direct path for CLI-only users
- legacy `AGENT_TOKEN` support exists only as a temporary compatibility fallback during rollout

## Why This Plan Needs To Exist

The current branch is directionally correct but still misses two critical requirements:

1. Desktop launch still uses `agent_tokens` / `AGENT_TOKEN` as the normal path.
   The protocol resolver now accepts OAuth JWTs, but the real Desktop launch flow still mints or loads agent tokens and injects `AGENT_TOKEN` into launched agents. That means the product has not actually completed the migration.

2. Shared Desktop/CLI credentials do not converge safely after refresh.
   CLI refresh updates `credentials.json`, but `electron-credentials.json` can retain stale encrypted tokens. Desktop can later rehydrate those stale values back into the shared file, rolling back a rotated refresh token and breaking the next refresh.

This plan updates the migration scope to close those gaps explicitly.

## Summary

The migration should be user-safe and mostly automatic:

- detect legacy credential shapes
- rewrite them in place to the OAuth-only schema when possible
- remove obsolete token artifacts
- require re-login only when migration cannot recover a valid OAuth session or org scope

The migration must cover the actual product paths, not just protocol helpers:

- CLI auth resolution
- Desktop login and session refresh
- Desktop agent launch
- protocol command examples
- docs, settings UI, snippets, and recovery copy

## Required End State

### 1. Unify protocol and MCP auth on OAuth JWTs

- Replace agent-token-only assumptions in `/api/protocol/*` with a shared resolver that accepts OAuth JWTs and returns a common auth context.
- Use the MCP auth shape as the canonical protocol auth context:
  - `userId`
  - `organizationId`
  - `authMethod`
  - raw bearer token
- Require explicit org scope from CLI/Desktop-backed protocol requests via `x-organization-id`.
- Do not silently choose the first org for protocol access.
- Keep a short transition path for legacy `agent_token` only if needed to avoid breaking already-installed builds during rollout.
- Target end state: OAuth-only protocol auth for normal use.

### 2. Redesign shared credentials around OAuth session state

Move Desktop and CLI to one OAuth-centered shared schema:

- `platform_url`
- `refresh_token`
- optional cached `access_token`
- optional `access_token_expires_at`
- `organization_id`
- optional `user_email`
- optional Desktop-only encrypted wrappers for the same logical fields

Add one shared auth helper used by both CLI and Desktop that:

- loads credentials
- migrates legacy credentials when possible
- refreshes access JWTs through `/auth/v1/oauth/token`
- returns request headers with:
  - `Authorization: Bearer <oauth-jwt>`
  - `x-organization-id`
- preserves localhost `x-overlord-local-secret` behavior

Remove the dependency on `/api/auth/token` for normal CLI/Desktop auth flows.

### 3. Preserve both login paths: Desktop handoff and direct CLI login

- Keep Desktop and CLI on the same `~/.ovld` auth record so Desktop login automatically logs the CLI in.
- Keep `ovld auth login` as a direct OAuth login path for CLI-only users.
- Support both existing CLI login styles:
  - loopback OAuth for local interactive use
  - device flow for headless or browser-mediated use
- After login, require org selection for multi-org users and persist that selection in shared credentials.

### 4. Add a first-use migration for legacy users

On Desktop startup and CLI auth resolution, detect legacy credential shapes and attempt in-place migration before prompting the user.

Migration behavior:

- if a valid OAuth refresh token already exists, promote it into the new schema and delete legacy `agent_token` fields
- if only a legacy `agent_token` exists and no refresh token can be recovered, clear legacy auth artifacts and require fresh login
- if org scope is missing or ambiguous, prompt for org selection and persist it
- rewrite credential files in place and delete unnecessary legacy fields/files automatically
- do not keep token backups by default

Update logout on both Desktop and CLI to remove the OAuth credential record completely so stale shared auth cannot survive re-login.

### 5. Remove legacy user-facing token flows and copy

- Remove settings, onboarding, docs, snippets, launch commands, and help text that instruct users to retrieve or export `AGENT_TOKEN` for normal product usage.
- Replace agent-token-specific recovery messaging with OAuth session messaging:
  - “log in again”
  - “refresh session”
  - “select an organization”
- Update launch and context generation so examples assume authenticated shared credentials or `ovld auth login`, not `AGENT_TOKEN`.

## Additional Scope Required By Review Findings

### A. Fix the real Desktop launch path

This is the biggest remaining gap.

Desktop launch must stop depending on:

- `ensureAgentTokenAction`
- `ensureAgentTokenForLaunchAction`
- agent-token-backed launch payloads
- exporting `AGENT_TOKEN` into launched agent environments as the normal path

Instead, Desktop launch must:

- resolve the shared OAuth session
- refresh the cached access token if needed
- include `x-organization-id` on protocol requests
- pass only the OAuth-backed shared credential context needed for `ovld protocol` and related helpers

This change must cover:

- web-side launch entry points that currently request agent tokens
- Electron launcher request headers
- environment variables and shell snippets generated for launched agents
- raw fallback launch commands

Compatibility fallback:

- legacy `AGENT_TOKEN` env vars may remain as an override for remote shells, CI, or explicit manual injection during the rollout window
- they must no longer be the default product path

### B. Make shared credentials converge safely

Desktop and CLI must not be able to overwrite each other with stale session state.

Required behavior:

- define one canonical logical credential record shared across Desktop and CLI
- when CLI refreshes the OAuth session, Desktop-visible state must also be updated or invalidated safely
- when Desktop loads encrypted credentials, it must not rewrite stale tokens back into the CLI file
- stale encrypted wrappers must not outrank fresher CLI session state
- if both files exist, the loader must deterministically choose the freshest valid session

Recommended rule:

- treat refresh token rotation as authoritative session change
- whichever side rotates the refresh token must update the shared record in a way the other side cannot accidentally roll back

### C. Finish legacy cleanup in launch/docs/UI surfaces

The migration is not done while normal product surfaces still teach users to use `AGENT_TOKEN`.

Cleanup must include:

- launch snippets and fallback commands
- settings UI and onboarding copy
- CLI reference docs
- authentication docs
- plugin and README guidance
- any “copy token” affordances that are still framed as the primary path

The only remaining `AGENT_TOKEN` references after cleanup should be:

- explicit compatibility notes
- remote-shell / CI override guidance
- temporary rollout-only internals where removal would break older clients

## Public Interface Changes

- `/api/protocol/*` accepts OAuth bearer JWTs and requires explicit org scope from CLI/Desktop clients
- `~/.ovld/credentials.json` and `~/.ovld/electron-credentials.json` move to one OAuth-only logical schema
- `ovld auth login`, `ovld auth status`, and logout flows report and store OAuth session state rather than agent-token presence
- Desktop launch and generated CLI examples assume shared OAuth credentials, not `AGENT_TOKEN`
- `/api/auth/token` becomes deprecated and then removable after all Desktop/CLI callers are migrated

## Implementation Plan

### Phase 1: Protocol and shared auth core

- keep the shared protocol auth resolver for OAuth JWTs plus temporary legacy token fallback
- require `x-organization-id` for OAuth-backed protocol calls
- centralize CLI/Desktop auth resolution around one shared credentials helper
- preserve localhost local-secret behavior

### Phase 2: Shared credentials convergence

- define the canonical OAuth-only shared schema
- implement legacy migration into that schema
- fix Desktop and CLI save/load semantics so they cannot roll back rotated refresh tokens
- make logout clear all shared auth artifacts consistently

### Phase 3: Login paths and refresh

- keep CLI loopback OAuth login
- keep device flow login
- persist org selection after login
- ensure access-token expiry triggers refresh from the stored refresh token
- ensure Desktop login immediately enables CLI protocol commands

### Phase 4: Desktop launch-path migration

- remove agent-token fetching from Desktop launch entry points
- update Electron launcher to use OAuth-backed auth headers
- include `x-organization-id` everywhere the launcher calls protocol APIs
- stop exporting `AGENT_TOKEN` as the normal launch env path
- update raw launch/fallback command generation accordingly

### Phase 5: Product cleanup

- remove or downgrade legacy token copy from settings, docs, snippets, and help text
- update recovery copy to OAuth-session language
- keep compatibility notes only where genuinely needed

### Phase 6: Deprecation removal

- after Desktop and CLI callers are migrated, deprecate and remove `/api/auth/token`
- remove now-dead agent-token launch helpers and related UI actions if they are no longer needed

## Test Plan

### Login and shared auth

- Desktop login writes shared OAuth credentials and CLI commands work immediately without separate login
- CLI loopback login stores the OAuth-only schema and can call protocol routes without `AGENT_TOKEN`
- CLI device login stores the OAuth-only schema and can call protocol routes without `AGENT_TOKEN`
- multi-org login prompts once, persists the selection, and subsequent protocol calls include the selected org

### Refresh and convergence

- access-token expiry triggers refresh from stored refresh token and requests continue succeeding
- CLI refresh followed by Desktop startup does not roll the session back
- Desktop refresh followed by CLI auth resolution does not roll the session back
- mixed Desktop/CLI credential files converge to one valid OAuth-only record
- stale encrypted Desktop wrappers cannot overwrite a newer CLI refresh token

### Legacy migration

- legacy file with refresh token migrates silently
- legacy file with only `agent_token` forces re-login and clears old token fields
- missing org scope prompts once and persists the result

### Protocol and launch behavior

- protocol routes reject missing org scope, invalid membership, expired JWTs, and malformed tokens
- Desktop launch performs protocol calls with OAuth bearer auth plus `x-organization-id`
- launched Desktop agent flows work without minting or exporting a normal-use `AGENT_TOKEN`
- raw fallback launch commands use shared OAuth auth assumptions rather than token export as the primary path

### Logout and cleanup

- logout from Desktop removes shared OAuth credentials and requires fresh login afterward
- logout from CLI removes shared OAuth credentials and requires fresh login afterward
- normal settings/docs/snippets no longer instruct users to fetch or export `AGENT_TOKEN`

### MCP

- MCP continues to work with OAuth JWT auth unchanged after the shared auth refactor

## Acceptance Criteria

- Desktop, CLI, and protocol all work normally without minting or pasting `AGENT_TOKEN`
- the normal Desktop launch path no longer depends on `agent_tokens`
- CLI and Desktop share one stable OAuth-backed auth state without token rollback bugs
- protocol requests from CLI/Desktop always send explicit org scope
- legacy users are migrated automatically when possible and asked to re-login only when necessary
- user-facing product copy treats OAuth session auth as the default path
- `AGENT_TOKEN` survives only as an explicit temporary compatibility override, not as the documented or generated normal flow

## Assumptions And Defaults

- OAuth refresh tokens may be stored locally for Desktop and CLI session continuity
- Desktop and CLI should continue sharing auth state through `~/.ovld`
- automatic migration should be attempted first; forced re-login is only the fallback
- legacy credential cleanup should rewrite files in place and remove obsolete token artifacts
- CLI-only users remain fully supported through direct OAuth login; Desktop is not required
