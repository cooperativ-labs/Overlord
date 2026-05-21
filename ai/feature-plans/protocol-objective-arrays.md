# Protocol Objective Arrays

## Summary

Agents need a first-class way to decompose a plan into ordered objectives on an existing ticket, and every ticket-creation command should be able to seed a ticket with multiple ordered objectives instead of a single objective string.

The requested contract is:

- Agents can submit an array of objective objects.
- Index `0` is the first objective to execute.
- Later indexes execute after that, in order.
- When adding objectives to an existing ticket, the API finds the ticket in the database and appends the new objectives after any objectives already on the ticket.
- All `ovld` commands that create tickets should also accept this objective-array shape.

## Current Behavior

- `ovld protocol create` without session flags calls `POST /api/protocol/tickets` and creates one draft objective through `upsertDraftObjective`.
- `ovld protocol create` with `--session-key` and `--ticket-id` calls `POST /api/protocol/create-ticket` and creates a linked follow-up ticket, not another objective on the same ticket.
- `ovld protocol prompt` / `spawn` creates a new ticket and immediately executes one objective.
- MCP `create_ticket` creates a follow-up ticket with one objective.
- MCP interactive draft ticket creation inserts one objective directly.
- The web UI already has future-objective mechanics: draft/future states, positions, reordering, auto-advance, and approval gates.

## Proposed Product Behavior

### New Existing-Ticket Operation

Add a protocol operation for appending objectives to an existing ticket.

Suggested surface names:

- API: `POST /api/protocol/add-objectives`
- CLI: `ovld protocol add-objectives`
- MCP: `add_objectives`

Payload shape:

```json
{
  "ticketId": "1:899",
  "objectives": [
    { "objective": "First step to execute", "title": "Optional short title" },
    { "objective": "Second step to execute", "title": "Optional short title" }
  ]
}
```

The API should resolve `ticketId` using the existing human-readable ticket ID / UUID resolution behavior, query the ticket, compute the current maximum objective `position`, and insert the submitted objective rows after existing rows. The first inserted row should become `draft` when there is no current draft/submitted/executing objective; otherwise inserted rows should be `future`. Remaining inserted rows should be `future`.

### Ticket Creation With Objective Arrays

All commands that create tickets should accept either the current single objective string or an objective-array payload:

- Human CLI: `ovld create`, `ovld prompt`
- Protocol CLI: `ovld protocol create`, `ovld protocol prompt` / `spawn`, `ovld protocol record-work`
- Hosted MCP tools: ticket creation and completed-work creation where applicable
- Local Codex MCP shim commands that map to those protocol operations
- Agent slash commands and plugin docs for Claude, Cursor, Gemini, OpenCode, and Codex

The first objective in the array determines the created ticket title when no explicit title is provided. For `prompt` / `spawn`, objective index `0` should become the executing objective; later objectives should be queued as `future` objectives with increasing positions. For draft creation, index `0` should be the draft objective and later objectives should be future objectives.

`record-work` should continue to represent already-completed work. If it accepts an objective array, only index `0` should be completed by the current record-work delivery unless the implementation explicitly supports multi-objective completed history. Later objectives should be queued as future objectives, not marked complete.

## Implementation Plan

1. Add shared objective-array parsing and validation.

Create a shared helper that accepts either:

- `objective: string`
- `objectives: Array<{ objective: string; title?: string; autoAdvance?: boolean; assignedAgent?: unknown }>`

Normalize to a non-empty ordered array of objective inputs. Preserve single-objective backwards compatibility and return clear validation errors when both forms conflict.

2. Add shared ordered-objective insertion.

Extend `lib/objectives.ts` with a helper that inserts ordered objectives for a ticket:

- Resolve existing objective count / max `position`.
- Preserve existing objective rows.
- Insert new rows after existing rows.
- Set index `0` to `draft` only when appropriate for the operation.
- Set follow-on rows to `future`.
- Preserve `created_by`, optional title, optional auto-advance, and assigned-agent metadata.
- Avoid `upsertDraftObjective` for multi-objective creation because it can overwrite an existing draft.

3. Implement `POST /api/protocol/add-objectives`.

The route should:

- Authenticate with `resolveAgentToken`.
- Resolve the public `ticketId` to the internal ticket UUID.
- Verify organization access.
- Insert ordered objectives after current objectives.
- Record a ticket event summarizing how many objectives were appended.
- Return inserted objective IDs, states, and positions.

4. Thread objective arrays through ticket creation APIs.

Update:

- `apps/web/app/api/protocol/tickets/route.ts`
- `apps/web/app/api/protocol/prompt/route.ts`
- `lib/overlord/protocol-spawn.ts`
- `supabase/functions/mcp/handlers/_ticket-drafts.ts`
- `supabase/functions/mcp/handlers/create-ticket.ts`
- `supabase/functions/mcp/handlers/record-work.ts`
- `lib/overlord/protocol-record-work.ts`
- Any validation schemas in `lib/overlord/validation.ts`

5. Update CLI surfaces.

Update `packages/overlord-cli/bin/_cli/protocol.mjs` to support:

- `ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[...]'`
- `ovld protocol add-objectives --ticket-id <ticket_id> --objectives-file <path|->`
- Objective arrays on `create`, `prompt` / `spawn`, and `record-work`

Also update the human CLI entrypoints for `ovld create` and `ovld prompt` so they accept equivalent array input where those commands bypass protocol handlers.

6. Update MCP surfaces.

Update hosted MCP and the local Codex MCP shim:

- Add `add_objectives`.
- Add `objectives` array support to ticket-creation tools that create tickets.
- Keep naming conventions aligned: hosted MCP camelCase, local shim snake_case.

7. Update agent plugin and slash-command guidance.

Update all affected plugin docs and command templates:

- `plugins/claude/skills/overlord-ticket/SKILL.md`
- `plugins/cursor/skills/overlord-ticket/SKILL.md`
- `plugins/overlord/skills/overlord-ticket/SKILL.md`
- Packaged copies under `packages/overlord-cli/plugins/**`
- Slash command templates and installed command docs for create/prompt/spawn where relevant

Tell agents to use `add-objectives` when the user asks to break a plan into ordered steps on the same ticket.

8. Update connector parity docs.

Update:

- `ai/guidence/CONNECTOR_SURFACES.md`
- `.claude/skills/drift-review/SKILL.md` if the parity extraction checklist needs the new operation
- `docs/public/users-guide.md`
- `docs/MCP_AUTH_AND_INTEGRATION.md`
- Any CLI help snapshots such as `docs/public/ovld-protocol-help.txt`

9. Test the full workflow.

Add or update tests for:

- Appending objectives to a ticket with no objectives, with a draft objective, and with completed objectives.
- Creating a draft ticket with multiple objectives.
- Prompt/spawn creating an executing first objective and queued future objectives.
- Record-work completing only the current objective and queuing future objectives.
- CLI JSON/file/stdin parsing.
- Hosted MCP schema and local shim parameter mapping.

## Acceptance Criteria

- An agent can run one command/tool call to append an ordered array of objectives to an existing ticket.
- New objectives are inserted after existing objectives and keep deterministic `position` ordering.
- Index `0` is the first newly added objective to execute; later indexes queue after it.
- Existing single-objective commands remain backwards compatible.
- Every ticket-creation command supports the objective-array shape.
- CLI, API, MCP, local shim, plugin skills, slash command docs, and connector-surface docs are all aligned.
- The implementation reuses shared helpers instead of duplicating objective state/position logic across routes.
