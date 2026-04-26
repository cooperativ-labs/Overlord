# Overlord Surface Drift Report

_Conducted: 2026-04-26 (ticket 584d5a48-a6c7-4c22-b1e8-f92dfd2dad3d)_

## Summary
- Surfaces audited: API (21 routes), CLI (18 subcommands), MCP (16 tools), Plugin Skills (3)
- Fully aligned operations: 8 (attach, connect, load-context, update, ask, deliver, read-context, write-context — modulo doc drift)
- Operations with parameter drift: 4 (attach, connect, spawn, deliver)
- Operations missing from one or more surfaces: 7
- Dead/empty scaffolds: 2 (`decision/`, `transcript-ingest/`)

## Alignment Matrix

| Operation | API Route | CLI Subcommand | MCP Tool | Claude Skill | Cursor Skill | Overlord Skill |
|---|---|---|---|---|---|---|
| auth-status | — | auth-status | — | — | — | — |
| discover-project | POST /discover-project | discover-project | discover_project | ✓ | — | ✓ |
| attach | POST /attach | attach | attach_ticket | ✓ | ✓ | ✓ |
| connect | POST /connect | connect | connect_ticket | ✓ | ✓ | — |
| load-context | POST /load-context | load-context | load_ticket_context | ✓ | ✓ | ✓ |
| create-ticket (follow-up) | POST /create-ticket | create | — | ✓ | ✓ | ✓ |
| create-ticket (standalone) | POST /tickets | create (same cmd) | — | ✓ | ✓ | ✓ |
| spawn | POST /spawn | spawn | spawn_ticket | ✓ | ✓ | ✓ |
| update | POST /update | update | post_update | ✓ | ✓ | ✓ |
| record-change-rationales | POST /change-rationales | record-change-rationales | record_change_rationales | ✓ | — | ✓ |
| ask | POST /ask | ask | ask_blocking_question | ✓ | ✓ | ✓ |
| permission-request | POST /permission-request | permission-request | — | — | — | — |
| read-context | POST /read-context | read-context | read_shared_context | ✓ | — | ✓ |
| write-context | POST /write-context | write-context | write_shared_context | ✓ | — | ✓ |
| deliver | POST /deliver | deliver | deliver_ticket | ✓ | ✓ | ✓ |
| artifact-prepare-upload | POST /artifacts/prepare-upload | artifact-prepare-upload | artifact_prepare_upload | — | — | — |
| artifact-finalize-upload | POST /artifacts/finalize-upload | artifact-finalize-upload | artifact_finalize_upload | — | — | — |
| artifact-upload-file (composite) | — (client-side) | artifact-upload-file | artifact_upload_file | ✓ | — | ✓ |
| artifact-download-url | POST /artifacts/get-download-url | artifact-download-url | artifact_download_url | ✓ | — | ✓ |
| context fetch | GET/POST /context/[ticketId] | — | — | — | — | — |
| projects (list) | GET /projects | — | — | — | — | — |
| list-tickets | POST /list-tickets | — | — | — | — | — |
| search-tickets | POST /search-tickets | — | search_tickets | — | — | mention only |
| decision | (empty dir) | — | — | — | — | — |
| transcript-ingest | (empty dir) | — | — | — | — | — |

## Drift Findings

### Critical Drift — Missing Operations

1. **search-tickets has no CLI subcommand.** Exists as `POST /api/protocol/search-tickets` and as MCP `search_tickets`. The Overlord plugin skill even references `ovld protocol search_tickets` (which is wrong syntax — that's an MCP name, not a CLI command). Agents that prefer the CLI surface cannot search tickets, fix this so that agents can search tickets using the CLI.

2. **list-tickets must be deleted and folded into search-tickets.** `POST /api/protocol/list-tickets` is a strict subset of `search-tickets` (status + includeCompleted, no query, no project, no user, no daterange) and creates two ways to do the same thing while neither covers the full filter set agents actually need. Required changes:
   - **Delete `POST /api/protocol/list-tickets`** and `listTicketsSchema`.
   - **Extend `searchTicketsSchema`** so `query` is optional (omitting it = list mode) and add `projectId`, `createdBy` (or `assignedAgent`), `updatedAfter`, `updatedBefore`. Rename `searchTicketsByTitle` → `searchTickets` and have it apply the new filters.
   - **CLI**: ship `ovld protocol search-tickets` with flags `--query`, `--status` (repeatable or csv), `--project-id`, `--created-by`, `--updated-after`, `--updated-before`, `--limit`, `--include-completed`.
   - **MCP**: extend the existing `search_tickets` tool with `project_id`, `created_by`, `updated_after`, `updated_before` (snake_case).
   - **Plugin skills**: update the Overlord skill's `ovld protocol search_tickets` reference to the new real CLI command, and document the new filters in claude/cursor/overlord skills.
   Net result: one operation, three aligned surfaces, full filter set, and finding 1 (`search-tickets has no CLI subcommand`) is resolved in the same change.

3. **create-ticket has no MCP tool.** Both create paths (`POST /create-ticket` for follow-ups and `POST /tickets` for standalones) are reachable via CLI `create` but absent from MCP. MCP only exposes `spawn_ticket`, which forces immediate execution. MCP-only callers cannot create draft tickets.

4. **permission-request is undocumented in every plugin skill.** Exists in API and CLI but no skill mentions it and no MCP tool wraps it. Either it's an internal-only hook (then strip from CLI?) or it should be documented.

5. **Empty scaffold routes.** `apps/web/app/api/protocol/decision/` and `apps/web/app/api/protocol/transcript-ingest/` are empty directories with no `route.ts`. delete the dirs.

6. **GET /api/protocol/context/[ticketId] and GET /api/protocol/projects are API-only.** Likely consumed by the desktop launcher; document that they're UI-private.

7. **CLI-only `auth-status`.** create a protocol `auth-status` CLI subcommand. .

### Parameter Drift

1. **`spawn_ticket` (MCP) is missing `personal` and `metadata`.** API `spawnSchema` accepts both; CLI `spawn` accepts `--personal` (no `--metadata-json` either, so CLI also has partial drift on `metadata`). Without `personal`, MCP callers can't create personal-scope tickets.

2. **`attach_ticket` (MCP) is missing `metadata`.** API accepts `metadata` (optional); CLI exposes `--metadata-json`. MCP omits it entirely.

3. **`connect_ticket` (MCP) is missing `metadata`.** Same pattern as attach.

4. **`spawn` CLI is missing `--metadata-json`.** API spawn schema has `metadata`; CLI spawn handler does not parse it.

5. **`deliver_ticket` (MCP) marks `artifacts` optional, API marks it required.** API `deliverSchema` lists `artifacts` as required; MCP `required` is only `[session_key, ticket_id, summary]`. MCP callers can submit a delivery with no artifacts and the API will reject — late failure.

6. **`attach` / `connect` requiredness mismatch.** API requires `agentIdentifier` and `connectionMethod`; CLI/MCP both treat them as optional with defaults (`claude-code` / `cli`). Defensible (defaults applied client-side) but undocumented — surface the defaults in the skills.

### Naming Drift

1. **`record-change-rationales` route is named `/api/protocol/change-rationales`** (verb stripped). CLI is `record-change-rationales`, MCP is `record_change_rationales`. Rename the route to `/record-change-rationales` for consistency.

2. **MCP tool naming**: most tools follow `<verb>_<noun>` (`attach_ticket`, `spawn_ticket`, `post_update`, `deliver_ticket`, `ask_blocking_question`, `load_ticket_context`) but artifact tools use `<noun>_<verb>` (`artifact_prepare_upload`, `artifact_download_url`). Minor cosmetic inconsistency. Fix this naming inconsistency.

### Documentation Drift

1. **`plugins/cursor/skills/overlord-ticket/SKILL.md` is dramatically thinner than its peers.** Missing: discover-project, read-context, write-context, record-change-rationales, all four artifact commands. At 35 lines vs Claude's 147 / Overlord's 133, cursor agents are operating with roughly half the documented surface. Bring it to parity.

2. **`plugins/overlord/skills/overlord-ticket/SKILL.md` does not document `connect`** (though it mentions `attach` for the same purpose). If `attach` always supersedes `connect` for that agent, document the choice; otherwise add `connect`.

3. **The Overlord skill says `ovld protocol search_tickets`** — that's an MCP tool name with a CLI prefix. Add the CLI subcommand and fix the doc.

4. **No plugin skill documents `artifact-prepare-upload` / `artifact-finalize-upload`.** Only the composite `artifact-upload-file` is mentioned. That's probably correct (composite is the agent-friendly path), but worth confirming the two-step variants are intentionally agent-internal. (Note that we are also fixing the naming inconsistency in this PR.)

## Recommendations (Prioritized)

1. **High** — Add `ovld protocol search-tickets` CLI subcommand (parity with API + MCP). Fixes the broken Overlord skill doc reference.
2. **High** — Add `personal` to `spawn_ticket` MCP schema; add `metadata` to `attach_ticket`, `connect_ticket`, `spawn_ticket` MCP schemas.
3. **High** — Add `--metadata-json` flag to CLI `spawn`.
4. **Medium** — Make `deliver_ticket` MCP `artifacts` required (or relax API), so client and server agree.
5. **Medium** — Add an MCP tool for ticket creation (`create_ticket`) so MCP-only flows can produce drafts without spawning.
6. **Medium** — Decide list-tickets, GET /context, GET /projects fate: surface on CLI/MCP or mark API-private.
7. **Medium** — Resolve the `change-rationales` vs `record-change-rationales` naming inconsistency between the API route and the CLI/MCP names.
8. **Medium** — Bring `plugins/cursor/skills/overlord-ticket/SKILL.md` to parity with claude/overlord variants.
9. **Low** — Delete empty `decision/` and `transcript-ingest/` route directories or scaffold real handlers.
10. **Low** — Document `permission-request` in skills, or scope it to internal hook usage.
11. **Low** — Surface attach/connect defaults (`agent=claude-code`, `method=cli`) in plugin skills so agents don't wonder why API requires fields the CLI omits.
