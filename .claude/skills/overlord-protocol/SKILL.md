<!-- version: 1.1.0 -->
---
Name: overlord-protocol
Description: Use when the environment contains PLATFORM_URL and TICKET_ID. Instructs the agent to attach to the Cooperativ overlord, post progress updates, ask blocking questions, manage shared context, and deliver a final summary when work is complete.
---

# overlord-protocol

## When to Apply

Apply this skill whenever the following environment variables are present:

- `PLATFORM_URL` — base URL of the running overlord (e.g. `http://localhost:3000`)
- `TICKET_ID` — UUID of the ticket to work on
- `AGENT_TOKEN` — bearer token for the protocol API

All API calls use `Authorization: Bearer $AGENT_TOKEN` and `Content-Type: application/json`.

---

## Protocol Lifecycle

### 1. Attach (always first)

Call this before doing any work. It creates a session and returns the ticket + event history.

```
POST $PLATFORM_URL/api/protocol/attach
{
  "ticketId": "$TICKET_ID",
  "agentIdentifier": "claude-code",   // or "codex", etc.
  "connectionMethod": "claude_code",  // one of: mcp | cli | rest | chatgpt | claude_app | claude_code | other
  "metadata": {}
}
```

**Response:**
```json
{
  "ticket": { "id": "...", "title": "...", "objective": "...", "acceptance_criteria": "...", "available_tools": "...", "status": "..." },
  "session": { "id": "...", "sessionKey": "<uuid>", "state": null },
  "history": [...],
  "sharedState": [...]
}
```

Store `session.sessionKey` — it is required for all subsequent calls.

Read `ticket.objective`, `ticket.acceptance_criteria`, and `ticket.available_tools` to understand what you need to do. Review `history` for prior agent activity and `sharedState` for any persisted context.

---

### 2. Post Updates (throughout work)

Call this after completing meaningful steps — not after every file edit, but after completing a logical unit of work (e.g., "analysed the bug", "updated migration", "wrote tests").

```
POST $PLATFORM_URL/api/protocol/update
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "summary": "Human-readable description of what was done and why.",
  "phase": "execute",   // optional — one of: draft | execute | review | deliver | complete | blocked | cancelled
  "payload": {}         // optional — any structured data worth persisting
}
```

Setting `phase` moves the ticket to that status. Use `"execute"` while actively working.

---

### 3. Record Important Decisions (optional)

Use this when you make a meaningful implementation decision that future sessions should inherit.

```
POST $PLATFORM_URL/api/protocol/decision
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "title": "Short decision summary",
  "rationale": "Why this choice was made.",
  "impact": "Tradeoffs or follow-up implications.",
  "phase": "execute",   // optional
  "payload": {}         // optional structured context
}
```

This writes both a timeline event and a persisted `shared_state` record tagged `decision`.

---

### 4. Ask a Blocking Question (when you need human input)

Use this when you cannot proceed without a decision from the PM/user. It marks the event `is_blocking: true` and moves the ticket to `review` (or the phase you specify). Stop working and wait after calling this.

```
POST $PLATFORM_URL/api/protocol/ask
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "question": "Clear, specific question the PM needs to answer.",
  "phase": "review",   // defaults to "review"
  "payload": {}        // optional supporting data
}
```

---

### 5. Read Shared Context (optional)

Retrieve persisted key/value state scoped to this ticket or global to the workspace.

```
POST $PLATFORM_URL/api/protocol/read-context
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "query": "optional key filter substring",
  "limit": 20
}
```

**Response:** `{ "context": [{ "state_key": "...", "state_value": ..., "tags": [...] }], "count": N }`

---

### 6. Write Shared Context (optional)

Persist findings, decisions, or data that future agents or sessions should know about.

```
POST $PLATFORM_URL/api/protocol/write-context
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "key": "descriptive-key-name",
  "value": <any JSON value>,
  "tags": ["optional", "tags"]
}
```

Use this for things like: confirmed architecture decisions, discovered constraints, test results, important file paths.

---

### 7. Deliver (always last)

Call this when the ticket work is fully complete. It marks the session `completed`, moves the ticket to `complete`, and stores artifacts. **Do not call this if the work is blocked or incomplete.**

```
POST $PLATFORM_URL/api/protocol/deliver
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "summary": "Narrative summary: what problems were considered, what decisions were made, and what next steps the PM should know about.",
  "artifacts": [
    {
      "type": "file_changes",
      "label": "Files modified",
      "content": "Paste of `git diff --stat` or a list of changed files with brief descriptions."
    },
    {
      "type": "next_steps",
      "label": "Recommended next steps",
      "content": "Bulleted list of follow-on tasks or open questions."
    }
  ]
}
```

The `summary` field is what the PM will read first — make it clear and narrative, not a list of shell commands.
If you omit a `Restart session command` artifact, the deliver route auto-appends one as a `note`.

**Artifact types** (use these labels consistently): `file_changes`, `next_steps`, `test_results`, `migration`, `decision`, `note`, `url`.

---

## Behaviour Rules

- Always call `attach` before any other protocol call.
- Always call `deliver` when done, even if the work was minor. The PM needs the feedback loop.
- Post at least one `update` before `deliver` so the timeline shows meaningful intermediate progress.
- If you hit an unresolvable blocker, call `ask` — do not guess.
- Use `write-context` for any information a future agent session should know (e.g., "auth uses service role key, not anon key").
- Include a `Restart session command` artifact when practical; `deliver` will auto-append one if missing.
- Never call `deliver` if you called `ask` and haven't received an answer — leave the session open.
- The `phase` field in `update` is optional; only set it when the ticket's visible status should change.

---

## Examples

### Minimal happy path (running locally via CLI)

When running locally, use the `npx overlord protocol` CLI — it reads auth and `TICKET_ID` from environment variables automatically.

```bash
# 1. Attach — prints full JSON response; read session.sessionKey from it
npx overlord protocol attach

# SESSION_KEY="<value from response.session.sessionKey>"

# 2. Update mid-work
npx overlord protocol update --session-key <SESSION_KEY> \
  --summary "Identified root cause: missing index on ticket_events.ticket_id causing full table scans." \
  --phase execute

# 3. Deliver
npx overlord protocol deliver --session-key <SESSION_KEY> \
  --summary "Added composite index on ticket_events (ticket_id, created_at). Query time dropped from ~400ms to ~8ms in local testing. No breaking schema changes." \
  --artifacts-json '[{"type":"file_changes","label":"Files modified","content":"supabase/migrations/20260218_add_ticket_events_index.sql"},{"type":"next_steps","label":"Next steps","content":"- Run supabase db reset on staging to apply migration\n- Monitor query performance after deploy"}]'
```

### Minimal happy path (remote / web context, using curl)

```bash
# 1. Attach
curl -s -X POST $PLATFORM_URL/api/protocol/attach \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"'$TICKET_ID'","agentIdentifier":"claude-code","connectionMethod":"claude_code"}'

# SESSION_KEY="<value from response.session.sessionKey>"

# 2. Update mid-work
curl -s -X POST $PLATFORM_URL/api/protocol/update \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionKey":"'$SESSION_KEY'","ticketId":"'$TICKET_ID'","summary":"Identified root cause: missing index on ticket_events.ticket_id causing full table scans.","phase":"execute"}'

# 3. Deliver
curl -s -X POST $PLATFORM_URL/api/protocol/deliver \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionKey":"'$SESSION_KEY'",
    "ticketId":"'$TICKET_ID'",
    "summary":"Added composite index on ticket_events (ticket_id, created_at). Query time dropped from ~400ms to ~8ms in local testing. No breaking schema changes.",
    "artifacts":[
      {"type":"file_changes","label":"Files modified","content":"supabase/migrations/20260218_add_ticket_events_index.sql"},
      {"type":"next_steps","label":"Next steps","content":"- Run supabase db reset on staging to apply migration\n- Monitor query performance after deploy"}
    ]
  }'
```
