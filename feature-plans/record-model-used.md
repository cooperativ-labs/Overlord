# Feature Plan: Record the Model Used on Attach

## Overview

When an agent attaches to a ticket, record which AI model it's using. Display this as a tooltip on the agent badge in both Kanban and List views.

## Current State

- `agent_sessions` has a `metadata` JSONB column (currently defaults to `{}`)
- The attach endpoint already accepts `metadata` as an optional field
- The `ActiveAgentDisplay` component in `KanbanCard.tsx` renders agent icon + label
- `TicketListCard.tsx` has a similar agent display
- Realtime sync in `KanbanBoard.tsx` picks `agent_identifier` and `session_state` from sessions — but not metadata

## Plan

### Step 1: Pass model in attach metadata

The attach protocol already supports `metadata: Record<string, unknown>`. Agents just need to include `{ model: "claude-opus-4-6" }` (or similar) in the metadata when attaching.

**File:** `lib/overlord/ticket-prompt.ts` (or wherever the prompt template is built)
- Add a line to the system prompt instructing agents to pass `--metadata-json '{"model":"<model-id>"}'` when calling attach. Alternatively, this can be injected by the CLI tooling.

**File:** `npx overlord protocol attach` CLI
- If the CLI already forwards `--metadata-json`, no change needed — agents just need to include it. Check if the CLI supports a `--metadata-json` flag; if not, add one.

**No schema migration needed** — the `metadata` JSONB column already exists on `agent_sessions`.

### Step 2: Propagate model through realtime sync

Currently `KanbanBoard.tsx` only picks `ticket_id`, `session_state`, and `agent_identifier` from sessions. We need to also pick `metadata` so the model info reaches the card.

**File:** `app/tickets/(components)/KanbanBoard.tsx`
1. Update `applySessionOverride` parameter type to include `metadata`:
   ```ts
   Pick<AgentSession, 'ticket_id' | 'session_state' | 'agent_identifier' | 'metadata'>
   ```
2. In `syncBoardData`, add `metadata` to the select query:
   ```ts
   .select('ticket_id,session_state,agent_identifier,attached_at,metadata')
   ```
3. Add `agent_model` to `RealtimeTicketPatch`:
   ```ts
   agent_model?: string | null;
   ```
4. In `applySessionOverride`, extract model from metadata:
   ```ts
   patch.agent_model = isAttached ? (session.metadata as any)?.model ?? null : null;
   ```

### Step 3: Thread model through Ticket type

**File:** `app/tickets/(components)/KanbanCard.tsx`
1. Add to the `Ticket` type:
   ```ts
   agent_model?: string | null;
   ```

**File:** `app/tickets/(components)/KanbanBoard.tsx`
1. Apply `agent_model` from the realtime patch to the ticket object (same pattern as `running_agent`).

### Step 4: Show model as tooltip on agent badge

**File:** `app/tickets/(components)/KanbanCard.tsx`
1. Update `ActiveAgentDisplay` to accept an optional `model` prop:
   ```ts
   function ActiveAgentDisplay({ identifier, model }: { identifier: string | null; model?: string | null })
   ```
2. Wrap the badge content in a `title` attribute (native tooltip) or use the existing `Tooltip` component from shadcn:
   ```tsx
   <div className="min-w-0" title={model ? `Model: ${model}` : undefined}>
     {/* existing icon + label */}
   </div>
   ```
3. Pass `ticket.agent_model` from `KanbanCardBody`:
   ```tsx
   <ActiveAgentDisplay identifier={activeAgentIdentifier} model={ticket.agent_model} />
   ```

**File:** `app/tickets/(components)/TicketListCard.tsx`
- Apply the same tooltip pattern for the agent display there.

### Step 5: Record model from the agent prompt side

The system prompt template injected by Overlord already tells agents their model (e.g., "You are powered by the model named Opus 4.6"). We need agents to forward this when attaching.

**Option A (recommended):** Have the `npx overlord resume` / `npx overlord protocol attach` CLI automatically detect the model from the environment or agent config, and inject it into metadata. This is the cleanest approach since agents don't need to do it manually.

**Option B:** Update the ticket prompt template to instruct agents to pass metadata with the model. Less reliable since it depends on agent compliance.

**Preferred approach:** Option A — modify the CLI `attach` command to accept a `--model` flag that gets merged into metadata automatically.

**File:** CLI source (wherever `npx overlord protocol attach` is implemented)
- Add `--model <string>` flag
- Merge into metadata: `metadata = { ...metadata, model: modelFlag }`

### Step 6: Backfill via agent identifier heuristic (optional)

For sessions where no model metadata exists, we could derive a sensible default:
- `claude-code` → show "Claude" (no specific model)
- `cursor` → show "Cursor" (model varies)
- This is optional polish — the tooltip would simply not appear if no model data exists.

## Files Changed Summary

| File | Change |
|------|--------|
| `app/tickets/(components)/KanbanCard.tsx` | Add `agent_model` to Ticket type, add `model` prop to `ActiveAgentDisplay`, render tooltip |
| `app/tickets/(components)/TicketListCard.tsx` | Same tooltip pattern for list view |
| `app/tickets/(components)/KanbanBoard.tsx` | Propagate `metadata` through realtime sync, extract `agent_model` |
| CLI attach command source | Add `--model` flag, merge into metadata |
| Prompt template (optional) | Instruct agents to pass model metadata |

## No Migration Needed

The `metadata` JSONB column on `agent_sessions` already exists and can store `{ "model": "claude-opus-4-6" }` without any schema change.

## Edge Cases

- **No model provided:** Tooltip simply doesn't appear — graceful degradation
- **Model name formatting:** Display the raw model ID; could add a display-name mapping later if desired
- **Multiple sessions:** Realtime sync already picks the most recent session, so the model shown will be from the current/latest session
