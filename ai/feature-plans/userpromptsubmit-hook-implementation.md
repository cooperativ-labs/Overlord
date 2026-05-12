# Implementation Plan: UserPromptSubmit Hook for Activity Feed

## Overview

Replace the current instruction-driven `user_follow_up` mechanism — which relies on the agent
voluntarily recognising a follow-up message and dispatching an `ovld protocol update` call — with a
system-level `UserPromptSubmit` hook that fires unconditionally before Claude processes each user
turn. This makes follow-up capture guaranteed and zero-latency.

A secondary improvement adds a new `POST /api/protocol/hook-event` API route (and matching CLI
subcommand / MCP tool) that accepts hook payloads without a session key, so the hook script can
authenticate with only `TICKET_ID` + `OVERLORD_ACCESS_TOKEN` — both already present in every
Overlord-launched shell.

---

## Motivation / Current Problem

| Problem | Root cause |
|---|---|
| Follow-up messages often missing from activity feed | Agent must notice the message and choose to call `ovld protocol update --event-type user_follow_up` |
| Latency: feed update arrives after Claude has already responded | Agent calls the update *during* or *after* processing, not at submission time |
| Extra tokens / risk of instruction drift | The `user_follow_up` rule paragraph must be kept in every agent's skill/AGENTS.md/rules file |
| No session key at hook time | Hooks fire before `attach` is called in some flows; the current `update` route requires a valid `sessionKey` |

---

## Architecture Decision: New `hook-event` Endpoint

The `UserPromptSubmit` hook fires **before** Claude calls `attach`, so no session key exists yet.
Rather than require the hook to call `attach` first (which is slow and stateful), introduce a
lightweight endpoint that accepts hook events using only bearer-token + ticket-id authentication:

```
POST /api/protocol/hook-event
Authorization: Bearer <OVERLORD_ACCESS_TOKEN>
{
  "hookType": "UserPromptSubmit",
  "ticketId": "1:1005",
  "prompt": "<verbatim user prompt>",
  "turnIndex": 1           // 0 = initial ticket prompt, skip; ≥1 = follow-up
}
```

This endpoint:
- Validates the bearer token (same JWT auth as all protocol routes).
- Rejects `turnIndex === 0` (the initial ticket delivery — not a follow-up).
- Inserts a `user_follow_up` ticket event directly, without requiring a session.
- Sets `created_by` from the token identity.
- Returns `{ ok: true }` or a non-blocking error (hook exits 0 regardless).

---

## Changes by Surface

### 1. Agent Plugin: Claude Code (`plugins/claude/`)

#### a. `hooks/hooks.json`

Add a `UserPromptSubmit` hook alongside the existing `PermissionRequest` hook.

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": ".*",
        "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/permission-hook.sh" }]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/user-prompt-submit-hook.sh" }]
      }
    ]
  }
}
```

#### b. New `scripts/user-prompt-submit-hook.sh`

```bash
#!/bin/bash
# Overlord UserPromptSubmit hook — fires before Claude processes each user turn.
# Skips turn 0 (the initial ticket prompt); captures follow-ups unconditionally.
BODY=$(cat -)
OVERLORD_BASE_URL="${CLAUDE_PLUGIN_OPTION_OVERLORD_URL:-$OVERLORD_URL}"
OVERLORD_TOKEN="${CLAUDE_PLUGIN_OPTION_OVERLORD_ACCESS_TOKEN:-$OVERLORD_ACCESS_TOKEN}"

# turn_number is 0 for the first message; skip it
TURN=$(printf '%s' "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('turn_number',0))" 2>/dev/null || echo "0")
if [ "$TURN" = "0" ]; then exit 0; fi

if [ -n "$OVERLORD_BASE_URL" ] && [ -n "$OVERLORD_TOKEN" ] && [ -n "$TICKET_ID" ]; then
  PROMPT=$(printf '%s' "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('prompt',''))" 2>/dev/null || echo "")
  PAYLOAD=$(printf '{"hookType":"UserPromptSubmit","ticketId":"%s","prompt":"%s","turnIndex":%s}' \
    "$TICKET_ID" \
    "$(printf '%s' "$PROMPT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null | tr -d '"')" \
    "$TURN")
  curl -sf -m 5 \
    -X POST "$OVERLORD_BASE_URL/api/protocol/hook-event" \
    -H "Authorization: Bearer $OVERLORD_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    >/dev/null 2>&1 &
  disown
fi
exit 0
```

> **Note on implementation:** The shell script above uses `python3` for JSON escaping as a
> dependency-free option available on all macOS/Linux hosts. An alternative is to build the payload
> using `jq` with a guard (`command -v jq`), which handles Unicode and special characters more
> reliably. Prefer `jq` when available, fall back to `python3`.

#### c. `plugins/claude/.claude-plugin/plugin.json`

Bump `version` to the next minor (e.g. `0.2.0`). No other structural changes needed.

#### d. Skill file (`skills/overlord-ticket/SKILL.md` / plugin SKILL)

Remove the paragraph:

> **If the user sends you a message during your session, immediately publish a `user_follow_up`
> activity event with the user's message recorded verbatim in the summary before doing anything
> else. This DOES NOT apply to the initial ticket.**

Replace with a short note:

> Follow-up messages from the human user are automatically captured by the installed
> `UserPromptSubmit` hook. You do not need to call `ovld protocol update --event-type
> user_follow_up` manually.

---

### 2. Agent Plugin: Codex (`plugins/overlord/.codex-plugin/`)

Codex exposes `UserPromptSubmit` via `hooks.json` (same shape as Claude Code). Add a
`user-prompt-submit-hook.sh` script under `plugins/overlord/scripts/` and register it:

```json
// plugins/overlord/.codex-plugin/hooks.json (new file)
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [{ "type": "command", "command": "${CODEX_PLUGIN_ROOT}/scripts/user-prompt-submit-hook.sh" }]
      }
    ]
  }
}
```

The script content is identical to the Claude version but reads
`CODEX_PLUGIN_OPTION_*` env vars as the plugin-config source:

```bash
OVERLORD_BASE_URL="${CODEX_PLUGIN_OPTION_OVERLORD_URL:-$OVERLORD_URL}"
OVERLORD_TOKEN="${CODEX_PLUGIN_OPTION_OVERLORD_ACCESS_TOKEN:-$OVERLORD_ACCESS_TOKEN}"
```

Also update `.codex-plugin/plugin.json` to reference the hooks file:

```json
{
  "hooks": "./.codex-plugin/hooks.json",
  ...
}
```

Update Codex's bundled skill to remove the same `user_follow_up` instruction paragraph.

---

### 3. Cursor CLI

Cursor CLI does **not** yet expose `UserPromptSubmit` (confirmed in research). No hook changes for
Cursor in this iteration. The existing instruction in `CURSOR_RULES_CONTENT` must remain until
Cursor ships full lifecycle hooks for the CLI.

Add a `// TODO: add UserPromptSubmit hook when Cursor CLI supports it` comment in
`installer.ts` `installCursor()` so it is visible at the right callsite.

---

### 4. CLI: `ovld protocol hook-event`

Add a new subcommand to `packages/overlord-cli/src/commands/protocol/`:

```
ovld protocol hook-event \
  --hook-type UserPromptSubmit \
  --ticket-id <id> \
  --prompt <text> \
  --turn-index <n>
```

- Maps to `POST /api/protocol/hook-event`.
- Reads `OVERLORD_URL` / `OVERLORD_ACCESS_TOKEN` from env (no `--session-key` needed).
- Exits 0 on success or on non-fatal API errors (same contract as other hook scripts).
- An alternative higher-level helper `ovld protocol report-follow-up` could alias this for clarity.

Update `packages/overlord-cli/src/commands/protocol/index.ts` to register the new subcommand.

---

### 5. MCP Tool: `record_hook_event`

Add to `supabase/functions/mcp/` (or the hosted MCP shim):

```typescript
// Tool name: record_hook_event
// Description: Record a lifecycle hook event (e.g. UserPromptSubmit) without a session key.
{
  name: "record_hook_event",
  description: "Record a hook lifecycle event for a ticket. Use hookType='UserPromptSubmit' to capture follow-up user messages without requiring a session key.",
  inputSchema: {
    type: "object",
    properties: {
      hookType: { type: "string", enum: ["UserPromptSubmit", "Stop"] },
      ticketId: { type: "string" },
      prompt: { type: "string" },
      turnIndex: { type: "number" }
    },
    required: ["hookType", "ticketId"]
  }
}
```

The MCP tool calls `POST /api/protocol/hook-event` internally (same as the CLI route).

---

### 6. API: `POST /api/protocol/hook-event`

**File:** `apps/web/app/api/protocol/hook-event/route.ts` (new file)

```typescript
// POST /api/protocol/hook-event
// Auth: Bearer token (JWT). No session key required.
// Purpose: Accept hook lifecycle events from agent hook scripts.
```

**Request body schema** (`lib/overlord/validation.ts` addition):

```typescript
export const hookEventSchema = z.object({
  hookType: z.enum(['UserPromptSubmit', 'Stop']),
  ticketId: z.string().min(1),
  prompt: z.string().optional(),
  turnIndex: z.number().int().min(0).optional()
});
```

**Route logic:**

1. Parse + validate body against `hookEventSchema`.
2. Authenticate via existing JWT middleware (same as all protocol routes).
3. Resolve `ticketId` → UUID via `resolveTicketId()`.
4. If `hookType === 'UserPromptSubmit'`:
   - Return early (`{ ok: true }`) if `turnIndex === 0` (initial ticket prompt).
   - Insert `ticket_events` row:
     ```sql
     event_type = 'user_follow_up'
     summary    = prompt (trimmed, max 10000 chars)
     created_by = userId from JWT
     session_id = NULL   -- no session at hook time
     payload    = { hook_type: 'UserPromptSubmit', turn_index: turnIndex }
     ```
5. If `hookType === 'Stop'` (future): insert an `update` event with a generic summary.
6. Return `{ ok: true }`. Always return 200 for non-auth errors to keep hook scripts silent.

**Auth note:** The route uses the same `parseProtocolBody` helper as other protocol routes, which
extracts `organizationId` and `userId` from the JWT. No additional session resolution is needed.

---

### 7. `ticket_events` Table / `user_follow_up` Event

No schema migration required. The `user_follow_up` event type already exists in:
- `lib/overlord/types.ts` — `protocolEventTypes` array
- `database.types.ts` — `ticket_event_type` enum

The only data difference from the existing approach is that `session_id` will be `NULL` for
hook-originated events (the hook fires before `attach`). The frontend already handles `null`
`session_id` gracefully.

**Optional enrichment (deferred):** After `attach` succeeds, the session could be linked back to
the most recent `user_follow_up` event by updating its `session_id`. This is a nice-to-have and
can be done in a follow-up.

---

### 8. `desktop/electron`: `agent-launcher.ts` — Pre-attach for session key injection

**Current state:** The agent calls `attach` itself on first turn; `OVERLORD_SESSION_KEY` is never
in the env before that.

**This iteration:** The `hook-event` endpoint does not require a session key, so no launcher
change is needed for `UserPromptSubmit`.

**Future (deferred):** If the `Stop` hook needs the session key (e.g. to post a structured
turn-end update), the launcher could pre-attach and inject `OVERLORD_SESSION_KEY` before spawning
the agent. That would require:
1. `prepareAgentLaunch()` in `agent-launcher.ts` calling `POST /api/protocol/attach` before
   building the shell command.
2. Adding `OVERLORD_SESSION_KEY` to `launchEnv`.
3. Updating the `Stop` hook script to use it.

This is **out of scope** for the current plan.

---

### 9. `desktop/electron`: `installer.ts` / `templates.ts`

- **`installer.ts` `installClaude()`:** The plugin directory copy already handles `hooks/hooks.json`
  and `scripts/`. When the two new files (`hooks.json` update + `user-prompt-submit-hook.sh`) are
  added to `plugins/claude/`, the installer will pick them up automatically on next install/repair.
  Bump `BUNDLE_VERSION` in `templates.ts` to trigger a stale-bundle prompt for existing users.

- **`templates.ts` `CLAUDE_SKILL_CONTENT`:** Remove the `user_follow_up` instruction paragraph
  (see §1d above). This string is embedded in the installed `SKILL.md` — update it and bump
  `BUNDLE_VERSION` so existing installs are marked stale.

- **`templates.ts` `OPENCODE_AGENTS_SECTION`:** Same removal. OpenCode does not yet have a hook
  mechanism; the instruction must stay until a hook surface is available. Leave a `// TODO` comment.

- **`templates.ts` `CURSOR_RULES_CONTENT`:** Leave unchanged (see §3).

---

### 10. Activity Feed: Frontend Presentation

**Current state** (`LiveActivityFeed.tsx`, `conversation.ts`): `user_follow_up` events already
render with avatar, sky-blue colour scheme, and profile name. No change needed for core
rendering.

**Improvements to make:**

#### a. Source indicator
Hook-originated events have `session_id = null` and `payload.hook_type = 'UserPromptSubmit'`.
Add a small visual indicator (e.g. a lightning bolt icon or "via hook" tooltip) to distinguish
automatic captures from agent-dispatched ones.

In `LiveActivityFeed.tsx`:

```tsx
const isHookCaptured = isUserFollowUp && getEventPayload(event).hook_type === 'UserPromptSubmit';
// Add to the event header row:
{isHookCaptured && (
  <span title="Captured automatically by hook" className="text-xs text-muted-foreground/60">⚡</span>
)}
```

#### b. `isUserFollowUpEvent` in `conversation.ts`
Already handles `event_type === 'user_follow_up'` — no change needed.

#### c. Real-time feed update
`LiveActivityFeed` subscribes to `ticket_events` via Supabase Realtime. Hook-sourced events
are standard DB rows, so they appear in real-time without any frontend change.

---

## Migration / Rollout

| Step | Who | What |
|---|---|---|
| 1 | Backend | Add `hookEventSchema` to `validation.ts` |
| 2 | Backend | Implement `POST /api/protocol/hook-event` route |
| 3 | CLI | Add `ovld protocol hook-event` subcommand |
| 4 | MCP | Add `record_hook_event` tool to MCP server |
| 5 | Plugin (Claude) | Update `hooks/hooks.json` + add `scripts/user-prompt-submit-hook.sh` |
| 6 | Plugin (Codex) | Add `hooks.json` + script; update `plugin.json` |
| 7 | Desktop | Bump `BUNDLE_VERSION`; update `CLAUDE_SKILL_CONTENT` to remove manual instruction |
| 8 | Frontend | Add hook-source indicator to `LiveActivityFeed` |
| 9 | Docs | Update agent docs to describe automatic follow-up capture |

Steps 1–4 can be done in a single PR. Steps 5–9 follow after the API is deployed.

Existing sessions continue working during rollout: the old instruction-based path still functions
until the bundle is updated. After update, the hook takes over and the instruction is removed.

---

## Testing Checklist

- [ ] Hook script fires on turn 2+ of a Claude Code session (confirm via activity feed event)
- [ ] Hook script does **not** fire on turn 0 (initial ticket)
- [ ] `POST /api/protocol/hook-event` rejects invalid bearer tokens with 401
- [ ] `POST /api/protocol/hook-event` returns 200 even if `ticketId` not found (non-blocking)
- [ ] Event appears in `LiveActivityFeed` in real-time with sky-blue styling and user avatar
- [ ] `⚡` indicator appears on hook-sourced events; absent on agent-dispatched ones
- [ ] Old bundle (without hook): agent instruction still works as fallback
- [ ] New bundle (with hook): agent instruction removed; hook captures message
- [ ] Codex: same hook fires on Codex sessions (after plugin update)
- [ ] Cursor: no regression (instruction still present in rules file)

---

## Open Questions / Deferred

1. **`Stop` hook:** Implement after `UserPromptSubmit` is stable. Requires pre-attach session key
   injection in the launcher for structured summaries, or a separate lighter-weight endpoint.
2. **`turnIndex` source:** Claude Code's `UserPromptSubmit` hook payload includes `turn_number`.
   Confirm the exact JSON field name from Claude Code docs before shipping the script.
3. **jq vs python3:** Decide which JSON tool to require in the hook script; add a comment
   explaining the choice and fallback.
4. **Retry / queue:** If the API is unavailable, hook-sourced events are silently lost. For now
   this is acceptable (same as the old path). A local queue could be added later.
5. **Session back-fill:** Linking `session_id` on the `user_follow_up` row after `attach` completes
   would make the event appear in session-scoped views. Deferred.
