/**
 * Resource templates for the Overlord local agent bundle.
 *
 * These define the content installed into agent-specific config directories
 * (~/.claude/, ~/.config/opencode/) so that durable workflow instructions live locally
 * rather than being re-sent in every ticket prompt.
 */

/** Current bundle version — bump when template content changes materially. */
export const BUNDLE_VERSION = '1.13.0';

/** Markers used to delimit Overlord-owned sections in user-managed files. */
export const MD_MARKER_START = '<!-- overlord:managed:start -->';
export const MD_MARKER_END = '<!-- overlord:managed:end -->';
export const JSON_MARKER_KEY = '__overlord_managed';

/**
 * Claude Code: SKILL.md content for ~/.claude/skills/overlord-local/
 *
 * This skill teaches Claude Code the durable Overlord local workflow rules
 * so they don't need to be repeated in every ticket prompt.
 */
export const CLAUDE_SKILL_CONTENT = `---
name: overlord-local
description: Overlord local workflow protocol — attach, update, deliver lifecycle for ticket-driven work.
---

# Overlord Local Workflow

If you receive a prompt with a specified ticket ID, adhere to the following. If the prompt does not have a ticket ID, the user may choose to add one later, but otherwise, proceed without it.

## Lifecycle

1. **Attach first** — If there is a TICKET_ID, always call attach before doing any work:
   \`\`\`bash
   ovld protocol attach --ticket-id $TICKET_ID
   \`\`\`
   Store \`session.sessionKey\` from the response — it is required for all subsequent calls.

2. **Update during work** — Post at least one progress update before delivering:
   \`\`\`bash
   ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
   \`\`\`
   Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`.
   Use \`execute\` while working.

   Pass \`--event-type <type>\` to publish a specific activity event (default: \`update\`):
   - \`update\` — standard progress update (default)
   - \`user_follow_up\` — a message or question from the human user when the automatic hook is unavailable
   - \`alert\` — surface a warning or non-blocking alert

3. **Ask when blocked** — Stop working after calling:
   \`\`\`bash
   ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
   \`\`\`

4. **Deliver last** — Always deliver when done:
   \`\`\`bash
   ovld protocol deliver --session-key <sessionKey> \\
     --ticket-id $TICKET_ID \\
     --summary "Narrative: what you did, next steps." \\
     --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \\
     --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
   \`\`\`
   For larger delivery JSON, prefer \`--payload-file -\` and stream the full payload on stdin so no scratch file needs to be created or removed. If you use \`--payload-file\`, \`--artifacts-file\`, or \`--change-rationales-file\` with a real path, treat that file as ephemeral scratch data outside the repository and remove it after delivery. Do not leave delivery JSON checked into the worktree.

## Change Rationales

Always include \`changeRationales\` when delivering. Optionally include them on updates during long-running work.

Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact.

These are structured protocol payloads that Overlord stores as first-class rows in the \`file_changes\` table. Prefer inline JSON or the dedicated command below. For larger full delivery payloads, prefer \`--payload-file -\` so summary, artifacts, and change rationales stay in one JSON document without creating a temporary file. Ordinary deliver artifacts should use \`next_steps\`, \`test_results\`, \`migration\`, \`note\`, \`url\`, or \`decision\`.

\`\`\`bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \\
  --summary "Recorded rationale details for the latest code changes." --phase execute \\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

\`\`\`bash
ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID \\
  --summary "Added retry logic." --phase execute \\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

Record only meaningful behavioral changes — skip formatting-only noise. Prefer 1–5 concise rationales per ticket, each tied to a specific file and diff hunk.

## Objective Submission vs Execution

Discussing or otherwise opening a ticket from within a chat should cause the draft objective to be marked **submitted** — this signals the ticket is in active discussion with an agent, but not yet being executed. Only an explicit order to execute (e.g. "execute this", "do this", "start working on it") should cause you to **attach** to the ticket and trigger execution.

- **Discussing / opening a ticket** → submit the objective:
  \`\`\`bash
  ovld protocol discuss-objective --ticket-id $TICKET_ID
  \`\`\`
  This transitions the objective from \`draft\` to \`submitted\`. No session is created.

- **Creating a ticket** via \`ovld protocol create\` keeps the objective in \`draft\` state.

- **Explicitly ordered to execute** → attach to the ticket:
  \`\`\`bash
  ovld protocol attach --ticket-id $TICKET_ID
  \`\`\`
  This transitions the objective from \`submitted\` (or \`draft\`) to \`executing\` and begins a session.

Do not attach to a ticket just because it was mentioned or opened in conversation. Only attach when the user clearly asks you to execute the work.

## Finding And Connecting To Tickets

If the user references a ticket but does not give an ID, search by keyword/status:

\`\`\`bash
ovld protocol search-tickets --query "auth refactor" --status next-up,execute --limit 10
\`\`\`

Use \`connect\` instead of \`attach\` when you only need a session key without the full ticket payload, and \`load-context\` to inspect a ticket without creating a session at all:

\`\`\`bash
ovld protocol connect --ticket-id $TICKET_ID
ovld protocol load-context --ticket-id $TICKET_ID
\`\`\`

When you open or discuss an existing ticket that has a draft objective, submit it:

\`\`\`bash
ovld protocol discuss-objective --ticket-id $TICKET_ID
\`\`\`

## Project Discovery & Ticket Creation

When creating tickets from within a repository:
- Prefer \`ovld protocol create --agent claude-code\` by default for draft ticket creation.
- Use \`ovld protocol prompt --agent claude-code\` only when the user explicitly asks to create and execute immediately.
- Both commands can resolve the project from the current working directory; use \`--working-directory\` to override.
- Create multiple tickets when prompts represent different features or goals.
- Add objectives to the same ticket when prompts are sequential steps toward the same feature or goal: \`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`.

\`\`\`bash
ovld protocol create --agent claude-code --objective "Capture follow-up work from this repository"
\`\`\`

\`\`\`bash
ovld protocol prompt --agent claude-code --objective "Implement feature X" --priority medium
\`\`\`

To discover which project maps to the current directory:

\`\`\`bash
ovld protocol discover-project
\`\`\`

You can override with \`--project-id\` or \`--working-directory\` if needed.

### Choosing \`--execution-target\`

Pass \`--execution-target agent\` or \`--execution-target human\` (default: \`human\`) when creating tickets.

- **\`agent\`** — any task an AI agent can complete in a computer environment: coding, internet research, document editing, data analysis, automated testing, etc.
- **\`human\`** — any task requiring human presence or judgment: setting credentials or tokens in a third-party UI (e.g. Vercel, AWS), sending physical mail, making a product or business decision, physical-world actions.

When in doubt, ask yourself: *can this be done entirely inside a terminal or browser by an AI without human intervention?* If yes → \`agent\`. If it requires a human to log in, decide, or act in the real world → \`human\`.

## Context & Artifacts

\`\`\`bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol attachment-upload-file --session-key <sessionKey> --objective-id <objective-id> --file ./spec.pdf --content-type application/pdf
ovld protocol attachment-download-url --session-key <sessionKey> --attachment-id <attachment-id>
\`\`\`

Objective attachments also expose two-step variants — \`attachment-prepare-upload\` and \`attachment-finalize-upload\` — for callers that need a signed URL directly. Prefer \`attachment-upload-file\` for one-shot uploads.

## Defaults & Notes

- The Overlord API requires \`agentIdentifier\` and \`connectionMethod\` on attach/connect/prompt. The CLI defaults them based on the active agent (e.g. \`claude-code\`/\`cli\`); the MCP tool defaults to \`mcp\`. Override with \`--agent\` / \`--method\` when calling from a different runtime.
- \`permission-request\` is invoked by the installed permission hook/rules; agents do not normally call it directly.
- If Overlord is unreachable because \`OVERLORD_URL\` cannot be reached, request permission escalation or network access before retrying.
- \`record_change_rationales\` (MCP) and \`ovld protocol record-change-rationales\` (CLI) both write to the \`file_changes\` table; the dedicated route is \`POST /api/protocol/record-change-rationales\`.
- Objective attachment MCP tools follow \`<verb>_<noun>\` naming: \`prepare_attachment_upload\`, \`finalize_attachment_upload\`, \`get_attachment_download_url\`, \`upload_attachment_file\`. CLI commands use the \`attachment-*\` shape and require \`--objective-id\` for upload/finalize.
- "Artifacts" in \`deliver\` are the structured records an agent submits at delivery time (next_steps, test_results, migration, decision, note, url) — not user-uploaded files.

## Rules

- Always attach first; always deliver when done.
_ Always communicate with Overlord using the ovld protocol cli commands.
- Post any substantial updates about your decisions or progress
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative, not a command list.
- Use \`write-context\` for facts a future agent session should know.
- **Follow-up messages after the initial ticket are captured automatically by the installed \`UserPromptSubmit\` hook. Do not post \`user_follow_up\` manually unless the hook is unavailable.**
- **Do not add or commit changes (git commit) unless the user explicitly asks you to commit.**
- **Delivery is the concluding step.** After delivering, stop working. Do not continue unless the user follows up or the ticket is reopened.
`;

export const OPENCODE_AGENTS_SECTION = `# Overlord Local Workflow

If you receive a prompt with a specified ticket ID, adhere to the following. If the prompt does not have a ticket ID, the user may choose to add one later, but otherwise, proceed without it.

## Lifecycle

1. **Attach first** — If there is a TICKET_ID, always call attach before doing any work:
   \`\`\`bash
   ovld protocol attach --ticket-id $TICKET_ID
   \`\`\`
   Store \`session.sessionKey\` from the response — it is required for all subsequent calls.

2. **Update during work** — Post at least one progress update before delivering:
   \`\`\`bash
   ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
   \`\`\`
   Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`.
   Use \`execute\` while working.

   Pass \`--event-type <type>\` for activity events: \`update\`, \`user_follow_up\`, \`alert\`.

3. **Ask when blocked** — Stop working after calling:
   \`\`\`bash
   ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
   \`\`\`

4. **Deliver last** — Always deliver when done:
   \`\`\`bash
   ovld protocol deliver --session-key <sessionKey> \\
     --ticket-id $TICKET_ID \\
     --summary "Narrative: what you did, next steps." \\
     --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \\
     --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
   \`\`\`
   For larger delivery JSON, prefer \`--payload-file -\` and stream the full payload on stdin so no scratch file needs to be created or removed. If you use \`--payload-file\`, \`--artifacts-file\`, or \`--change-rationales-file\` with a real path, treat that file as ephemeral scratch data outside the repository and remove it after delivery. Do not leave delivery JSON checked into the worktree.

## Change Rationales

Always include \`changeRationales\` when delivering. Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact. Record only meaningful behavioral changes. Overlord stores these as structured rows in the \`file_changes\` table. For larger delivery payloads, prefer \`--payload-file -\` with stdin. If you need a JSON file for transport, keep it ephemeral and out of the repository.

\`\`\`bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \\
  --summary "Recorded rationale details for the latest code changes." --phase execute \\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

## Objective Submission vs Execution

When discussing or opening a ticket, the draft objective should be marked **submitted** — this signals it has been reviewed but does NOT start execution. Only when the user explicitly orders execution (e.g. "execute this", "do this", "start working on it") should you **attach** to the ticket, which triggers execution.

- **Discussing / opening a ticket** → submit the objective:
  \`\`\`bash
  ovld protocol discuss-objective --ticket-id $TICKET_ID
  \`\`\`

- **Creating a ticket** via \`ovld protocol create\` keeps the objective in \`draft\` state.

- **Explicitly ordered to execute** → attach to the ticket:
  \`\`\`bash
  ovld protocol attach --ticket-id $TICKET_ID
  \`\`\`
  This transitions the objective from \`submitted\` (or \`draft\`) to \`executing\` and begins a session.

Do not attach to a ticket just because it was mentioned or opened in conversation. Only attach when the user clearly asks you to execute the work.

## Finding And Connecting To Tickets

If the user references a ticket but does not give an ID, search by keyword/status:

\`\`\`bash
ovld protocol search-tickets --query "auth refactor" --status next-up,execute --limit 10
\`\`\`

Use \`connect\` instead of \`attach\` when you only need a session key without the full ticket payload, and \`load-context\` to inspect a ticket without creating a session at all:

\`\`\`bash
ovld protocol connect --ticket-id $TICKET_ID
ovld protocol load-context --ticket-id $TICKET_ID
\`\`\`

When you open or discuss an existing ticket that has a draft objective, submit it:

\`\`\`bash
ovld protocol discuss-objective --ticket-id $TICKET_ID
\`\`\`

## Project Discovery & Ticket Creation

When creating tickets from within a repository:
- Prefer \`ovld protocol create --agent opencode\` by default for draft ticket creation.
- Use \`ovld protocol prompt --agent opencode\` only when the user explicitly asks to create and execute immediately.
- Both commands can resolve the project from the current working directory; use \`--working-directory\` to override.
- Create multiple tickets when prompts represent different features or goals.
- Add objectives to the same ticket when prompts are sequential steps toward the same feature or goal: \`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`.

\`\`\`bash
ovld protocol create --agent opencode --objective "Capture follow-up work from this repository"
\`\`\`

\`\`\`bash
ovld protocol prompt --agent opencode --objective "Implement feature X" --priority medium
\`\`\`

To discover which project maps to the current directory:

\`\`\`bash
ovld protocol discover-project
\`\`\`

You can override with \`--project-id\` or \`--working-directory\` if needed.

### Choosing \`--execution-target\`

Pass \`--execution-target agent\` or \`--execution-target human\` (default: \`human\`) when creating tickets.

- **\`agent\`** — any task an AI agent can complete in a computer environment: coding, internet research, document editing, data analysis, automated testing, etc.
- **\`human\`** — any task requiring human presence or judgment: setting credentials or tokens in a third-party UI (e.g. Vercel, AWS), sending physical mail, making a product or business decision, physical-world actions.

When in doubt, ask yourself: *can this be done entirely inside a terminal or browser by an AI without human intervention?* If yes → \`agent\`. If it requires a human to log in, decide, or act in the real world → \`human\`.

## Context & Artifacts

\`\`\`bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol attachment-upload-file --session-key <sessionKey> --objective-id <objective-id> --file ./spec.pdf --content-type application/pdf
ovld protocol attachment-download-url --session-key <sessionKey> --attachment-id <attachment-id>
\`\`\`

Objective attachments also expose two-step variants — \`attachment-prepare-upload\` and \`attachment-finalize-upload\` — for callers that need a signed URL directly. Prefer \`attachment-upload-file\` for one-shot uploads.

## Defaults & Notes

- The Overlord API requires \`agentIdentifier\` and \`connectionMethod\` on attach/connect/prompt. The CLI defaults them based on the active agent (e.g. \`claude-code\`/\`cli\`); the MCP tool defaults to \`mcp\`. Override with \`--agent\` / \`--method\` when calling from a different runtime.
- \`permission-request\` is invoked by the installed permission hook/rules; agents do not normally call it directly.
- If Overlord is unreachable because \`OVERLORD_URL\` cannot be reached, request permission escalation or network access before retrying.
- \`record_change_rationales\` (MCP) and \`ovld protocol record-change-rationales\` (CLI) both write to the \`file_changes\` table; the dedicated route is \`POST /api/protocol/record-change-rationales\`.
- Objective attachment MCP tools follow \`<verb>_<noun>\` naming: \`prepare_attachment_upload\`, \`finalize_attachment_upload\`, \`get_attachment_download_url\`, \`upload_attachment_file\`. CLI commands use the \`attachment-*\` shape and require \`--objective-id\` for upload/finalize.
- "Artifacts" in \`deliver\` are the structured records an agent submits at delivery time (next_steps, test_results, migration, decision, note, url) — not user-uploaded files.

## Rules

- Always attach first; always deliver when done.
- Always communicate with Overlord using the ovld protocol cli commands.
- Post any substantial updates about your decisions or progress
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative.
- Use \`write-context\` for facts a future agent session should know.
- **If the user sends you a message during your session, immediately publish a \`user_follow_up\` activity event with the user's message recorded verbatim in the summary before doing anything else. This DOES NOT apply to the initial ticket**
- **Do not create a new branch and do not add or commit changes (git commit) unless the user explicitly asks you to commit.**
- **Delivery is the concluding step.** After delivering, stop working. Do not continue unless the user follows up or the ticket is reopened.
`;

/**
 * Cursor: global rule file for ~/.cursor/rules/overlord-local.mdc
 *
 * Installed with alwaysApply: true so the workflow is always active.
 */
export const CURSOR_RULES_CONTENT = `---
description: Overlord local workflow protocol — attach, update, deliver lifecycle for ticket-driven work.
globs:
alwaysApply: true
---

# Overlord Local Workflow

If you receive a prompt with a specified ticket ID, adhere to the following. If the prompt does not have a ticket ID, the user may choose to add one later, but otherwise, proceed without it.

## Lifecycle

1. **Attach first** — If there is a TICKET_ID, always call attach before doing any work:
   \`\`\`bash
   ovld protocol attach --ticket-id $TICKET_ID
   \`\`\`
   Store \`session.sessionKey\` from the response — it is required for all subsequent calls.

2. **Update during work** — Post at least one progress update before delivering:
   \`\`\`bash
   ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
   \`\`\`
   Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`.
   Use \`execute\` while working.

   Pass \`--event-type <type>\` for activity events: \`update\`, \`user_follow_up\`, \`alert\`.

3. **Ask when blocked** — Stop working after calling:
   \`\`\`bash
   ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
   \`\`\`

4. **Deliver last** — Always deliver when done:
   \`\`\`bash
   ovld protocol deliver --session-key <sessionKey> \\
     --ticket-id $TICKET_ID \\
     --summary "Narrative: what you did, next steps." \\
     --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \\
     --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
   \`\`\`
   For larger delivery JSON, prefer \`--payload-file -\` and stream the full payload on stdin so no scratch file needs to be created or removed. If you use \`--payload-file\`, \`--artifacts-file\`, or \`--change-rationales-file\` with a real path, treat that file as ephemeral scratch data outside the repository and remove it after delivery. Do not leave delivery JSON checked into the worktree.

## Change Rationales

Always include \`changeRationales\` when delivering. Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact. Record only meaningful behavioral changes. Overlord stores these as structured rows in the \`file_changes\` table. For larger delivery payloads, prefer \`--payload-file -\` with stdin. If you need a JSON file for transport, keep it ephemeral and out of the repository.

\`\`\`bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \\
  --summary "Recorded rationale details for the latest code changes." --phase execute \\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

## Finding And Connecting To Tickets

If the user references a ticket but does not give an ID, search by keyword/status:

\`\`\`bash
ovld protocol search-tickets --query "auth refactor" --status next-up,execute --limit 10
\`\`\`

Use \`connect\` instead of \`attach\` when you only need a session key without the full ticket payload, and \`load-context\` to inspect a ticket without creating a session at all:

\`\`\`bash
ovld protocol connect --ticket-id $TICKET_ID
ovld protocol load-context --ticket-id $TICKET_ID
\`\`\`

## Project Discovery & Ticket Creation

When creating tickets from within a repository:
- Prefer \`ovld protocol create --agent cursor\` by default for draft ticket creation.
- Use \`ovld protocol prompt --agent cursor\` only when the user explicitly asks to create and execute immediately.
- Both commands can resolve the project from the current working directory; use \`--working-directory\` to override.
- Create multiple tickets when prompts represent different features or goals.
- Add objectives to the same ticket when prompts are sequential steps toward the same feature or goal: \`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`.

\`\`\`bash
ovld protocol create --agent cursor --objective "Capture follow-up work from this repository"
\`\`\`

\`\`\`bash
ovld protocol prompt --agent cursor --objective "Implement feature X" --priority medium
\`\`\`

To discover which project maps to the current directory:

\`\`\`bash
ovld protocol discover-project
\`\`\`

You can override with \`--project-id\` or \`--working-directory\` if needed.

### Choosing \`--execution-target\`

Pass \`--execution-target agent\` or \`--execution-target human\` (default: \`human\`) when creating tickets.

- **\`agent\`** — any task an AI agent can complete in a computer environment: coding, internet research, document editing, data analysis, automated testing, etc.
- **\`human\`** — any task requiring human presence or judgment: setting credentials or tokens in a third-party UI (e.g. Vercel, AWS), sending physical mail, making a product or business decision, physical-world actions.

When in doubt, ask yourself: *can this be done entirely inside a terminal or browser by an AI without human intervention?* If yes → \`agent\`. If it requires a human to log in, decide, or act in the real world → \`human\`.

## Context & Artifacts

\`\`\`bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol attachment-upload-file --session-key <sessionKey> --objective-id <objective-id> --file ./spec.pdf --content-type application/pdf
ovld protocol attachment-download-url --session-key <sessionKey> --attachment-id <attachment-id>
\`\`\`

Objective attachments also expose two-step variants — \`attachment-prepare-upload\` and \`attachment-finalize-upload\` — for callers that need a signed URL directly. Prefer \`attachment-upload-file\` for one-shot uploads.

## Defaults & Notes

- The Overlord API requires \`agentIdentifier\` and \`connectionMethod\` on attach/connect/prompt. The CLI defaults them based on the active agent (e.g. \`claude-code\`/\`cli\`); the MCP tool defaults to \`mcp\`. Override with \`--agent\` / \`--method\` when calling from a different runtime.
- \`permission-request\` is invoked by the installed permission hook/rules; agents do not normally call it directly.
- If Overlord is unreachable because \`OVERLORD_URL\` cannot be reached, request permission escalation or network access before retrying.
- \`record_change_rationales\` (MCP) and \`ovld protocol record-change-rationales\` (CLI) both write to the \`file_changes\` table; the dedicated route is \`POST /api/protocol/record-change-rationales\`.
- Objective attachment MCP tools follow \`<verb>_<noun>\` naming: \`prepare_attachment_upload\`, \`finalize_attachment_upload\`, \`get_attachment_download_url\`, \`upload_attachment_file\`. CLI commands use the \`attachment-*\` shape and require \`--objective-id\` for upload/finalize.
- "Artifacts" in \`deliver\` are the structured records an agent submits at delivery time (next_steps, test_results, migration, decision, note, url) — not user-uploaded files.

## Rules

- Always attach first; always deliver when done.
- Always communicate with Overlord using the ovld protocol cli commands.
- Post any substantial updates about your decisions or progress
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative.
- Use \`write-context\` for facts a future agent session should know.
- **If the user sends you a message during your session, immediately publish a \`user_follow_up\` activity event with the user's message recorded verbatim in the summary before doing anything else. This DOES NOT apply to the initial ticket**
- **Do not create a new branch and do not add or commit changes (git commit) unless the user explicitly asks you to commit.**
- **Delivery is the concluding step.** After delivering, stop working. Do not continue unless the user follows up or the ticket is reopened.
`;

/**
 * The permission-request hook script content.
 * Identical to the one currently written per-session in agent-launcher.ts,
 * but installed durably so it doesn't need to be recreated on each launch.
 */
export const PERMISSION_HOOK_SCRIPT = `#!/bin/bash
# Overlord PermissionRequest notification hook (managed by Overlord)
BODY=$(cat -)
if [ -n "$TICKET_ID" ] && command -v ovld >/dev/null 2>&1; then
  { if [ -n "$BODY" ]; then printf '%s' "$BODY"; else printf '{}'; fi; } \\
    | ovld protocol permission-request --ticket-id "$TICKET_ID" --payload-file - \\
    >/dev/null 2>&1 &
  disown
fi
exit 0
`;
