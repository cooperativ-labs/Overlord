# ADR 0089: Hosted MCP runs slow finalization tools as MCP tasks

Date: 2026-11-20
Status: accepted
Contract version: [179.4.0](../CHANGELOG.md#17940---2026-11-20)
Supersedes: none
Contract impact: minor

## Context

MCP 2025-11-25 adds experimental task-augmented requests. A client sends `tools/call` with
`params.task`. The server answers at once with a `CreateTaskResult`, and the client polls
`tasks/get` and reads the result with `tasks/result`. Claude Code 2.1.319 and later backgrounds a
tool call that the server runs as a task and reports the result when it finishes.

Hosted `/mcp` already advertises 2025-11-25. It is a hand-written JSON-RPC handler, not the MCP
SDK, and it answers plain JSON, never an SSE stream. `overlord_deliver_session` and
`overlord_record_work` are its slowest calls: they seal the report, write the delivery and the
mission summary, and record-work also creates the mission. Both are replay-safe through a
caller-retained `operationId` (ADR 0075). The backend runs one replica. The plan is
`planning/feature-plans/hosted-mcp-tasks.md`.

## Decision

1. **Capability.** `initialize` declares `tasks: { list: {}, requests: { tools: { call: {} } } }`.
   It does not declare `cancel`. The handler cannot be stopped once it runs, and a delivery that
   commits after a reported cancel would mislead the person.
2. **Which tools.** Only `overlord_deliver_session` and `overlord_record_work` carry
   `execution: { taskSupport: 'optional' }`. Reads stay synchronous, because the model needs their
   answer before it can continue, and a client that backgrounds every task-capable call would
   otherwise defer it. Other tools answer a task request with `-32601`.
3. **Same operation.** A task runs the same handler, Protocol operation and RBAC gate as the
   synchronous call. It runs in the background under the caller's request context. A request
   without `params.task` is answered exactly as before.
4. **Status and result.** A task starts `working` and settles `completed`, or `failed` when the
   tool result has `isError` (the statusMessage carries its first line). `tasks/result` blocks
   until the task settles and returns the unchanged `CallToolResult` with
   `_meta["io.modelcontextprotocol/related-task"]`. The `CreateTaskResult` carries
   `_meta["io.modelcontextprotocol/model-immediate-response"]` naming the task and the receipt
   fallback.
5. **Binding.** A task is bound to the caller's profile and credential (USER_TOKEN id or browser
   session), or the workspace actor when no profile resolved. Another caller's task id answers
   `-32602 Task not found`, exactly like an unknown id, and `tasks/list` lists only the caller's
   tasks. Task ids are random UUIDs.
6. **Storage and limits.** Tasks live in backend process memory. A restart or rollout loses the
   bookkeeping, never a committed write; the client recovers the outcome with
   `overlord_delivery_receipt` and its `operationId`. Default ttl 15 minutes, maximum 60 minutes.
   A finished task stays readable until its ttl and at least 60 seconds after it settles. A caller
   may hold 10 unfinished tasks; beyond that `tools/call` answers `-32000`.
7. **Errors.** `-32602` joins the `/mcp` JSON-RPC error codes, for a malformed `params.task` and
   an unknown, expired or foreign task id or list cursor.
8. **Local shim.** The connector shim declares no task capability. Claude Code reaches hosted MCP
   directly, and the shim's clients (Codex, Cursor, Antigravity) do not use tasks yet.

## Consequences

- A task-capable client no longer waits on a delivery. Clients without task support see no change.
- Only one process can answer for a task. Running more than one backend replica requires a shared
  task store, or sticky routing for `/mcp`, before this capability can stay declared.
- `tasks/result` holds an HTTP request open until the task settles; a proxy in front of `/mcp`
  with a short timeout cuts it, and the client then falls back to polling `tasks/get`.
- Task elicitation (`input_required`) is not used. Hosted `/mcp` sends no server-to-client
  requests, and Overlord's ask is answered by people in Overlord, not by the client's user.
