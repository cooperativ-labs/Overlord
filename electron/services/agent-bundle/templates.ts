/**
 * Resource templates for the Overlord local agent bundle.
 *
 * These define the content installed into agent-specific config directories
 * (~/.claude/, ~/.codex/) so that durable workflow instructions live locally
 * rather than being re-sent in every ticket prompt.
 */

/** Current bundle version — bump when template content changes materially. */
export const BUNDLE_VERSION = '1.0.0';

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
   npx overlord protocol attach --ticket-id $TICKET_ID
   \`\`\`
   Store \`session.sessionKey\` from the response — it is required for all subsequent calls.

2. **Update during work** — Post at least one progress update before delivering:
   \`\`\`bash
   npx overlord protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
   \`\`\`
   Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`.
   Use \`execute\` while working.

   Pass \`--event-type <type>\` to publish a specific activity event (default: \`update\`):
   - \`update\` — standard progress update (default)
   - \`user_follow_up\` — a message or question from the human user (EXCLUDING THE INITIAL TICKET)
   - \`alert\` — surface a warning or non-blocking alert

3. **Ask when blocked** — Stop working after calling:
   \`\`\`bash
   npx overlord protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
   \`\`\`

4. **Deliver last** — Always deliver when done:
   \`\`\`bash
   npx overlord protocol deliver --session-key <sessionKey> \\
     --ticket-id $TICKET_ID \\
     --summary "Narrative: what you did, next steps." \\
     --artifacts-json '[{"type":"file_changes","label":"Files modified","content":"..."}]' \\
     --change-rationales-file /tmp/rationales.json
   \`\`\`

## Change Rationales

Always include \`changeRationales\` when delivering. Optionally include them on updates during long-running work.

\`\`\`bash
npx overlord protocol update --session-key <sessionKey> --ticket-id $TICKET_ID \\
  --summary "Added retry logic." --phase execute \\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

Record only meaningful behavioral changes — skip formatting-only noise. Prefer 1–5 concise rationales per ticket, each tied to a specific file and diff hunk.

## Context & Artifacts

\`\`\`bash
npx overlord protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
npx overlord protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
npx overlord protocol artifact-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --file ./spec.pdf --content-type application/pdf
\`\`\`

## Rules

- Always attach first; always deliver when done.
- Post any substantial updates about your decisions or progress
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative, not a command list.
- Use \`write-context\` for facts a future agent session should know.
- **If the user sends you a message during your session, immediately publish a \`user_follow_up\` activity event with the user's message recorded verbatim in the summary before doing anything else. This DOES NOT apply to the initial ticket.**
`;

/**
 * Codex: AGENTS.md section content for ~/.codex/AGENTS.md
 *
 * This gets appended inside Overlord-owned markers so it can be updated
 * without clobbering the user's own instructions.
 */
export const CODEX_AGENTS_SECTION = `# Overlord Local Workflow


If you receive a prompt with a specified ticket ID, adhere to the following. If the prompt does not have a ticket ID, the user may choose to add one later, but otherwise, proceed without it.

## Lifecycle

1. **Attach first** — If there is a TICKET_ID, always call attach before doing any work:
   \`\`\`bash
   npx overlord protocol attach --ticket-id $TICKET_ID
   \`\`\`
   Store \`session.sessionKey\` from the response — it is required for all subsequent calls.

2. **Update during work** — Post at least one progress update before delivering:
   \`\`\`bash
   npx overlord protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
   \`\`\`
   Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`.
   Use \`execute\` while working.

   Pass \`--event-type <type>\` for activity events: \`update\`, \`user_follow_up\`, \`alert\`.

3. **Ask when blocked** — Stop working after calling:
   \`\`\`bash
   npx overlord protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
   \`\`\`

4. **Deliver last** — Always deliver when done:
   \`\`\`bash
   npx overlord protocol deliver --session-key <sessionKey> \\
     --ticket-id $TICKET_ID \\
     --summary "Narrative: what you did, next steps." \\
     --artifacts-json '[{"type":"file_changes","label":"Files modified","content":"..."}]' \\
     --change-rationales-file /tmp/rationales.json
   \`\`\`

## Change Rationales

Always include \`changeRationales\` when delivering. Record only meaningful behavioral changes.

\`\`\`bash
npx overlord protocol update --session-key <sessionKey> --ticket-id $TICKET_ID \\
  --summary "Added retry logic." --phase execute \\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

## Context & Artifacts

\`\`\`bash
npx overlord protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
npx overlord protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
npx overlord protocol artifact-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --file ./spec.pdf --content-type application/pdf
\`\`\`

## Rules

- Always attach first; always deliver when done.
- Post any substantial updates about your decisions or progress
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative.
- Use \`write-context\` for facts a future agent session should know.
- **If the user sends you a message during your session, immediately publish a \`user_follow_up\` activity event with the user's message recorded verbatim in the summary before doing anything else. This DOES NOT apply to the initial ticket**
`;

/**
 * The permission-request hook script content.
 * Identical to the one currently written per-session in agent-launcher.ts,
 * but installed durably so it doesn't need to be recreated on each launch.
 */
export const PERMISSION_HOOK_SCRIPT = `#!/bin/bash
# Overlord PermissionRequest notification hook (managed by Overlord)
BODY=$(cat -)
if [ -n "$OVERLORD_URL" ] && [ -n "$AGENT_TOKEN" ] && [ -n "$TICKET_ID" ]; then
  curl -sf -m 5 \\
    -X POST "$OVERLORD_URL/api/protocol/permission-request?ticketId=$TICKET_ID" \\
    -H "Authorization: Bearer $AGENT_TOKEN" \\
    -H "X-Overlord-Local-Secret: $OVERLORD_LOCAL_SECRET" \\
    -H "Content-Type: application/json" \\
    -d "$BODY" \\
    >/dev/null 2>&1 &
  disown
fi
exit 0
`;
