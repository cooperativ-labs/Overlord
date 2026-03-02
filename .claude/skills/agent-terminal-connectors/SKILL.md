---
name: agent-terminal-connectors
description: Protocol and connector patterns for integrating terminal-based agents with Overlord, including permission-request notification handling.
allowed-tools: Read, Edit, Write, Grep, Glob
---

# agent-terminal-connectors

## Instructions

Use this skill when you are changing any agent-launch, terminal integration, or permission notification behavior in Overlord.

### Primary goals

1. Keep agent-specific behavior isolated in `electron/services/terminal-connectors.ts`.
2. Preserve one shared Overlord protocol event path for notifications:
`POST /api/protocol/permission-request?ticketId=<ticket-id>`.
3. Avoid putting agent-specific parsing logic in generic PTY plumbing.

### Required workflow

1. Identify which agent connector is affected (`codex`, `claude-code`, etc.).
2. Before changing parser logic, verify the latest official SDK/CLI/API docs for that agent runtime and prompt behavior.
3. Implement changes in the connector module first.
4. Keep generic PTY concerns (spawn/write/resize/kill) in `terminal-manager.ts`.
5. Add or update lightweight tests when parser behavior changes.

### Connector design rules

- Build connectors as small modules with a stable interface:
  - `createRuntime(env)`
  - `onData(chunk, runtimeState) -> ConnectorEvent[]`
- Emit normalized events only (`permission-requested`, etc.).
- Keep rolling buffers bounded and strip ANSI codes before matching patterns.
- Add dedupe/fingerprinting for prompt detection to prevent repeated notifications.
- Treat network notification delivery as best-effort and non-blocking.

### Codex-specific requirements

- Detect Codex permission prompts from PTY output patterns (for example, `Would you like to run the following command?` and approval choices).
- Include a short command preview in event payload when available.
- Never block terminal rendering while posting notifications.
- For external terminals, document limitations if output cannot be observed.

### API and payload conventions

- Route: `/api/protocol/permission-request?ticketId=<uuid>`
- Auth: `Authorization: Bearer <AGENT_TOKEN>`
- Include `X-Overlord-Local-Secret` header when available.
- Payload should include:
  - `source` (for example `codex-terminal`)
  - `command_preview` when parseable
  - raw or summarized prompt context when useful for UI/debugging

### Anti-patterns to avoid

- Parsing agent-specific prompt formats inside UI components.
- Duplicating notification POST logic in multiple files.
- Unbounded buffer growth from terminal streams.
- Triggering one notification per chunk for the same visible permission prompt.

## Examples

Example trigger requests:

- "Add support for Codex permission notifications."
- "Refactor terminal manager to support multiple agent connectors."
- "Update permission prompt parsing after Codex CLI changed wording."

<!-- version: 1.0.0 -->
