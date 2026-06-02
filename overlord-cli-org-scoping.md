# Organization Scoping in the Overlord CLI

This document covers every CLI command, function, and API touchpoint in the Overlord CLI and classifies how each resolves its organization.

---

## 1. Credential Resolution Layer (`credentials.mjs`)

**`resolveAuth({ organizationIdHint })`** is the single gateway to org resolution. Priority order:

| Priority | Source | Condition |
|---|---|---|
| 1 | `organizationIdHint` argument | Supplied by the caller (ticket id parse, `--organization-id` flag) |
| 2 | `OVERLORD_AGENT_TOKEN` + `OVERLORD_ORGANIZATION_ID` env | Agent token env path; org is *optional* |
| 3 | `OVERLORD_ACCESS_TOKEN` + `OVERLORD_ORGANIZATION_ID` env | OAuth env path; org is *required* (hard error if missing) |
| 4 | Stored credentials `agent_token` → `organization_id` | Credentials file |
| 5 | Stored credentials `refresh_token` → `organization_id` | Credentials file; org must be present or login fails |
| 6 | `null` | Local-dev fallback only |

**`buildAuthHeaders()`** emits `x-organization-id` header only when `organizationId` is non-null and finite.

The credentials file (`~/.ovld/credentials.cli.json`) stores a **single** `organization_id`. No multi-org context is persisted at rest.

---

## 2. Auth Commands (`auth.mjs`)

| Command | Org scoping | Flag available | Multi-org behavior |
|---|---|---|---|
| `ovld auth login` | Fetches org list, picks `organizations[0]` unless `--organization-id` is given | `--organization-id <id>` (optional) | **Gap**: no interactive org selection; must know org id in advance. Shows a hint about multiple orgs but doesn't offer a picker. |
| `ovld auth login --token <oat_…>` | Optional `--organization-id`; otherwise server derives from token membership at request time | `--organization-id <id>` (optional) | Agent token path: org is optional, falls back to server's membership lookup |
| `ovld auth status / status --verbose` | Reads resolved org, displays `organizationId` | None | Informational only |
| `ovld auth repair / logout` | No org logic | None | N/A |

---

## 3. Protocol Commands (`protocol.mjs`)

**Org resolution helper**: `resolveProtocolAuthForFlags(flags, ticketId)` extracts org from:
1. `organizationIdFromTicketId(ticketId)` — parses the `org:seq` prefix (e.g. `1:899` → org `1`).
2. `--organization-id` flag — legacy override for UUID ticket ids.
3. Fallback to default org in credentials.

### 3a. Ticket-scoped commands (org inferred from ticket id)

All session lifecycle commands accept `--ticket-id` and derive org from it automatically for human-readable ids (`1:899`). For UUID ticket ids, they rely on `--organization-id` or the credentials default.

| Command | Org inference | Notes |
|---|---|---|
| `attach` | From ticket id | Primary attach path; org is explicit in human-readable ids |
| `connect` | From ticket id | Lightweight session |
| `load-context` | From ticket id | Read-only, no session |
| `update` | From session ticket id | Session must be active |
| `heartbeat` | From session ticket id | |
| `deliver` | From session ticket id | |
| `ask` | From session ticket id | |
| `request-approval-gate` | From session ticket id | |
| `record-change-rationales` | From session ticket id | |
| `hook-event` | From `--ticket-id` flag | No session key required |
| `permission-request` | From `--ticket-id` flag | |
| `read-context` | From session ticket id | |
| `write-context` | From session ticket id | |
| `discuss-objective` | From `--ticket-id` flag | |
| `add-objectives` | From `--ticket-id` flag | |
| `request-execution` | From `--ticket-id` flag | |
| `attachment-list/prepare/finalize/download/upload` | From session ticket id | |

### 3b. Session-less commands with NO ticket id (use credentials default)

These commands have no ticket-id to infer org from. They use the default org stored in credentials. There is **no `--organization-id` flag** on most of these.

| Command | Org scoping | Gap |
|---|---|---|
| `discover-project` | Default org from credentials | Cannot discover projects in a different org |
| `get-device` | Default org from credentials | |
| `update-device` | Default org from credentials | |
| `list-project-resources` | Default org from credentials | |
| `add-project-resource` | Default org from credentials | |
| `update-project-resource` | Default org from credentials | |
| `complete-execution-launch` | Default org from credentials | |
| `fail-execution-launch` | Default org from credentials | |
| `search-tickets` | **Default org from credentials** | **Gap**: no `--organization-id` flag; cannot search tickets across orgs |
| `prompt` (standalone) | Default org, cwd for project discovery | Gap: only creates ticket in default org |
| `create` (standalone) | Default org, cwd for project discovery | Gap: same |
| `record-work` | Default org | No session, no ticket id hint |
| `revert` | Default org from credentials | Objective id is globally unique but auth org check happens |
| `auth-status` | Reads resolved org | Informational |

### 3c. Explicitly multi-org commands

| Command | Org behavior |
|---|---|
| `list-organizations` | Returns ALL orgs the authenticated user belongs to. No org filter in request body. The `x-organization-id` header is still sent but the server ignores it for filtering here. |
| `claim-execution` | Optional `--organization-id` or `OVERLORD_ORGANIZATION_ID`. When omitted, server claims across all target-sharing orgs for the user (designed to be org-agnostic). |
| `list-execution-requests` | Optional `--organization-id`; scopes to one org or credentials default |
| `clear-execution-requests` | Optional `--organization-id`; scopes to one org or credentials default |

---

## 4. `ovld add-cwd` (`add-cwd.mjs`)

**Gap (named explicitly in ticket):** Calls `resolveAuth({})` with no org hint. Fetches projects from `/api/protocol/projects` using the default org. If the user belongs to multiple orgs, **only projects from the stored default org are listed**. There is no `--organization-id` flag and no interactive org selection. The project labels include `organizationName` for disambiguation but you cannot switch which org you're browsing.

---

## 5. Interactive `ovld prompt` / `ovld create` (`new-ticket.mjs`)

Same issue as `add-cwd`: calls `resolveAuth()` with no hint, fetches projects only for the default org. No interactive org picker.

---

## 6. Runner (`runner.mjs`)

| Function | Org behavior |
|---|---|
| `createOrganizationScope(flags)` | If `--organization-id` or `OVERLORD_ORGANIZATION_ID` is set: pins to that org. Otherwise: calls `list-organizations` every 60s and fans out across ALL orgs. Cache is refreshed periodically so newly joined orgs are picked up without restart. |
| `createClaimOrganizationScope(flags)` | Pinned org if set; otherwise single org-agnostic poll (empty scope id) — server claims across all target-sharing orgs. |
| `claimExecution / listExecutionRequests / clearExecutionRequests` | Explicitly pass `--organization-id` when scoped; omit for default/all. |

The runner is the **only CLI surface** with real multi-org fan-out for execution requests.

---

## 7. API / Protocol Server (`protocol-auth.ts`, `_lib.ts`)

**Server-side org resolution (`resolveProtocolAuth` / `resolveAgentToken`):**

| Auth method | Org source | Behavior when no org hint |
|---|---|---|
| Local dev token | `organizationIdOverride ?? LOCAL_DEV_ORGANIZATION_ID (1)` | Defaults to org 1 |
| Agent token (`oat_`) | `x-organization-id` header or ticket id lookup → user's lowest org id | **Optional**: falls back to first membership gracefully |
| OAuth JWT | `x-organization-id` header (required) | **Required**: returns 400 if missing |

**`parseProtocolBody` in `_lib.ts`:**
- Runs `resolveProtocolOrganizationHintForTicketId(ticketId)` *before* auth resolution.
- Human-readable ids (`org:seq`) → org from prefix (no DB read).
- UUID ticket ids → DB lookup of `tickets.organization_id` (prevents stale Desktop credential org vs actual ticket org).
- No ticket id → `organizationHint = null` → only agent tokens work without header.

**`/api/auth/organizations`** (GET): accepts only Supabase OAuth access tokens. Returns all member orgs.

**`/api/protocol/organizations`** (POST): accepts agent tokens, OAuth, and local-dev. Returns all member orgs. Used by the runner for fan-out discovery.

---

## 8. Multi-Organization Gap Summary

| Gap | Location | Severity |
|---|---|---|
| `add-cwd` only lists one org's projects | `add-cwd.mjs` + `/api/protocol/projects` | High — named in ticket |
| `ovld search-tickets` is scoped to default org with no override | `protocol.mjs: protocolSearchTickets` | Medium — cross-org ticket search not possible |
| `ovld auth login` picks `organizations[0]` silently for multi-org users | `auth.mjs: authLogin` | Medium — no interactive picker |
| `discover-project` / `list-project-resources` can't target another org | `protocol.mjs` | Medium — must re-login to switch |
| Credentials file stores a single `organization_id` | `credentials.mjs` | By design, but root cause of many gaps above |
| `prompt` / `create` (standalone) can't target another org | `new-ticket.mjs` | Medium |
| Agent token path defers org to server (implicit) | `protocol-auth.ts` | Low — intentional design for headless CI |
| OAuth path strictly requires `x-organization-id` | `protocol-auth.ts` | By design — but CLI always sends it, so only a gap for direct API callers |
| `revert` has no ticket id path; uses default org | `protocol.mjs: protocolRevert` | Low — objective ids are unique |

---

## 9. Where Scoping Is Explicit, Implicit, Defaulted, or Missing

- **Explicit**: `ovld auth login --organization-id`, runner `--organization-id`, `ovld protocol <ticket-scoped command>` with human-readable ticket id (org is in the id string).
- **Implicit / auto-derived**: Server-side UUID ticket id lookup (DB); agent token membership fallback; `parseProtocolBody` pre-resolves org from ticket id before auth check.
- **Defaulted to stored credentials org**: All session-less protocol commands without `--organization-id` or ticket id; `add-cwd`; standalone `prompt` / `create`; `search-tickets`.
- **Missing / gap**: `add-cwd` project list; `search-tickets` cross-org; standalone ticket creation in a non-default org; `discover-project` across orgs; interactive auth login org selection.
