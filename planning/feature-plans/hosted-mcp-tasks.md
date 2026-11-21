# Hosted MCP: slow tools as MCP tasks

Objective: coo:1318.c8f4 (E4). Status: implemented for hosted MCP. ADR 0089, contract 179.4.0.

Contract impact: minor

## Why

Since Claude Code 2.1.319, when a server runs an MCP tool call as a task, Claude Code backgrounds
the call and reports the result when it finishes. Pressing Esc on a task's question means "answer
later" (2.1.325). Claude Code reaches Overlord through the hosted `/mcp` server, not a local shim.

## Findings

### 1. Which tools are slow

| Tool | Work on the request path | Decision |
| --- | --- | --- |
| `overlord_deliver_session` | Seals the report draft, writes the delivery, closes items and updates the mission summary under the mission-summary lock, then records changed-file evidence | Task (`optional`) |
| `overlord_record_work` | Creates the mission and objective, then does the same delivery writes | Task (`optional`) |
| `overlord_load_mission_context` | Read; one context assembly | Synchronous |
| `overlord_search_missions` | Read; ranked search | Synchronous |

The Gemini delivery summary no longer runs on the request path. Both finalization tools queue it
on the delivery-compose worker (`delivery_compose_queued`). Their request time is database work,
and it gets slow under mission-summary lock contention and with large payloads. The tasks change
protects that tail and frees the client right away.

Reads stay synchronous. The model needs their answer before it can take the next step, and a
client that backgrounds every task-capable call would otherwise defer it. Making a read a task
would add a `tasks/get` round trip without freeing the model.

### 2. The spec and the server implementation

- MCP 2025-11-25 "Tasks" (experimental) defines `capabilities.tasks` (`list`, `cancel`,
  `requests.tools.call`), tool-level `execution.taskSupport` (`forbidden` by default, `optional`,
  `required`), `params.task.ttl`, `CreateTaskResult`, `tasks/get`, `tasks/result` (blocks until a
  terminal status), `tasks/list`, `tasks/cancel`, and the related-task and
  model-immediate-response `_meta` keys. Receivers with an auth context MUST bind tasks to it.
- Hosted `/mcp` (`mcp/server.ts`) is a hand-written JSON-RPC handler that already advertises
  `2025-11-25`. It answers plain JSON, never SSE, and does not use the MCP SDK. No SDK upgrade is
  involved.
- The local shim (`connectors/core/scripts/overlord-mcp.mjs`) is also hand-written, speaks
  `2025-06-18`, and serves Codex, Cursor and Antigravity. Claude Code does not use it for model
  tools (ADR 0087 hooks mode only).

### 3. Implementation (done)

- `mcp/tasks.ts`: `McpTaskStore`. It holds tasks in memory, bound to an owner. It grants ttl
  (default 15 minutes, maximum 60), caps unfinished tasks per owner at 10, pages `tasks/list`
  newest first, and settles a task `completed` or `failed` (from `isError`). A runner that throws
  fails its task. It sweeps finished tasks once their ttl has passed and at least 60 seconds
  after they settled.
- `mcp/tool-catalog.ts`: `HOSTED_TASK_TOOLS` adds `execution: { taskSupport: 'optional' }` to
  deliver and record-work only. The shared catalog in `@overlord/contract/mcp-tools` is
  unchanged, so the shim advertises nothing.
- `mcp/server.ts`: `initialize` declares `tasks: { list, requests.tools.call }`, with no
  `cancel`. `tools/call` with `params.task` returns a `CreateTaskResult` and runs the same handler
  in the background under the request's async context, so the same RBAC applies. It answers
  `-32601` for a tool without task support and `-32602` for a malformed `params.task`. Added
  `tasks/get`, `tasks/result` and `tasks/list`. The owner key is profile + token id, or the
  workspace actor when no profile resolved. A foreign task id answers like an unknown one.
- `backend/app.ts`: when a task settles, it nudges the mutation poll loops, as a synchronous
  `/mcp` call already does.
- Tests: `backend/mcp-tasks.test.ts` (9 tests, run against SQLite) covers capability and
  tool-level negotiation, record-work and deliver run as tasks end to end, the unchanged
  synchronous path, a failed task, owner isolation, unknown ids and cursors, no `tasks/cancel`,
  and the store's ttl, concurrency, paging and expiry. `backend/mcp.test.ts` was updated so the
  hosted catalog equals the shared catalog plus widget and task metadata.

### 4. Task elicitation and Overlord ask

It does not fit today:

- Elicitation inside a task means the server sends `elicitation/create` on the `tasks/result`
  stream. Hosted `/mcp` sends no server-to-client requests because it answers plain JSON. It would
  first need the Streamable HTTP SSE response mode.
- Elicitation asks the person at the MCP client. `ovld protocol ask` asks the people watching the
  mission in Overlord (web, mobile), and they may answer hours later. Those audiences differ. A
  local user can already answer in chat.

The good fit is the reverse: a hosted ask tool that runs as a task and stays `working` until
someone answers in Overlord. Claude Code would background it and report the answer when it lands.
That needs a hosted ask tool, which does not exist yet; ask is CLI-only. It is listed as deferred
work.

## Decisions and tradeoffs

- **No `tasks/cancel`.** Once the handler runs, a delivery cannot be withdrawn. Reporting
  `cancelled` while the write commits would mislead the person, so the capability is not
  declared.
- **In-memory store.** The backend runs one Railway replica (`.railway/railway.ts`). A durable
  table would need a migration and a data-contract change to protect only bookkeeping: both tools
  are replay-safe (ADR 0075), and `overlord_delivery_receipt` recovers a lost task's outcome. The
  model-immediate-response text says so.
- **Hosted only.** The shim's clients do not use tasks, and Claude Code does not use the shim for
  model tools. Adding tasks there would need a protocol-version bump and a second implementation
  in plain JS, with no consumer.

## Risks

- A second backend replica would break task lookup. Before scaling out, add a shared store or
  sticky `/mcp` routing (ADR 0089, Consequences).
- A rollout or restart loses unfinished task bookkeeping. The client then gets `-32602` and has to
  use the receipt.
- `tasks/result` holds the request open. The Vercel `/mcp` rewrite may time out a long wait, so
  clients should poll `tasks/get`, which the spec recommends anyway.
- MCP tasks are experimental in 2025-11-25, and the wire shape may change in a later spec version.
- Tested against the spec text and our own dispatcher, not yet against a live Claude Code
  2.1.319+ session.

## Drift review

The task support is limited to the hosted server and documented in `mcp/README.md`,
`docs/src/content/docs/docs-for-agents/mcp.mdx`, `contract/architecture.md` (MCP Server) and
`contract/api/openapi.yaml` (`POST /mcp`, 6.2.0). Tool names, parameters and Protocol mappings
are unchanged, so the API, CLI and plugin surfaces have no new drift. The shim intentionally
offers no tasks.
