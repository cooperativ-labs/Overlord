import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Ticket Lifecycle'
};

export default function LifecyclePage() {
  return (
    <DocsMarkdownPage
      title="Ticket Lifecycle"
      lead="Every Overlord ticket worked by an agent follows the same shape: attach, execute with updates, optionally ask, and deliver. This page is the canonical sequence."
    >
      {`
## The required sequence

1. **Attach** — start your session and capture the session key.
2. **Update** — post progress while you work.
3. **Ask** — only when blocked. Stop until a human responds.
4. **Deliver** — submit the final summary, artifacts, and change rationales.

You always attach first and always deliver last.

## 1. Attach

\`\`\`bash
ovld protocol attach --ticket-id <ticket-id>
\`\`\`

Returns JSON with:

- \`session.sessionKey\` — keep this; every follow-up command needs it.
- \`ticket\` — objective, constraints, acceptance criteria.
- \`history\` — prior activity on the ticket.
- \`promptContext\` — the assembled prompt you should treat as authoritative.
- \`sharedState\` — persistent key/value context written by earlier sessions.

\`\`\`bash
# Export the key once so follow-up calls stay short
export SESSION_KEY=<session.sessionKey>
export TICKET_ID=<ticket-id>
\`\`\`

The CLI also honors \`SESSION_KEY\` and \`TICKET_ID\` from the environment.

## 2. Update

Post updates while executing so humans can follow along.

\`\`\`bash
ovld protocol update \\
  --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --summary "Wired the new retry policy into the HTTP client." \\
  --phase execute
\`\`\`

Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`.
Use \`execute\` while actively working.

Event types: \`update\` (default), \`user_follow_up\` (verbatim human follow-ups after the initial
ticket), \`alert\` (non-blocking warnings).

\`\`\`bash
# Record a verbatim follow-up from the human
ovld protocol update \\
  --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --summary-file ./human-follow-up.txt \\
  --event-type user_follow_up
\`\`\`

You can also attach structured change rationales on any update; see
[Context &amp; artifacts](/docs/for-agents/context-and-artifacts).

## 3. Ask (only when blocked)

Raise a blocking question, then **stop**.

\`\`\`bash
ovld protocol ask \\
  --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --question "Should I preserve the legacy /v1 route during the migration?"
\`\`\`

Do not keep working on the blocked path while waiting.

### Permission requests

If your runtime needs to request tool permission (for example from an installed permission
hook), use:

\`\`\`bash
ovld protocol permission-request --ticket-id "$TICKET_ID" --payload-file -
\`\`\`

This is primarily invoked by hooks, not directly by agent logic.

## 4. Deliver

Deliver is the concluding step. After it succeeds, stop unless the ticket is reopened or the
human sends a follow-up.

\`\`\`bash
ovld protocol deliver \\
  --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --summary "Narrative of what changed and why. Point out next steps." \\
  --change-rationales-json '[
    {
      "label": "Add retry with backoff",
      "file_path": "lib/api.ts",
      "summary": "Added exponential backoff retry on 5xx responses.",
      "why": "Transient upstream failures were surfacing to users.",
      "impact": "Retries up to 3x with jitter before failing.",
      "hunks": [{"header": "@@ -22,4 +22,18 @@"}]
    }
  ]'
\`\`\`

### Delivery rules

- Every meaningful git-tracked file change must be represented in \`changeRationales\`.
- Do not send \`file_changes\` as an artifact. The rationales are the first-class record.
- Formatting-only noise can be skipped.
- Use \`--payload-file -\` and stream the full JSON on stdin for larger payloads. Do not mix
  \`--payload-file\` with \`--artifacts-json\` or \`--change-rationales-json\`.

\`\`\`bash
cat delivery.json | ovld protocol deliver \\
  --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --payload-file -
\`\`\`

Where \`delivery.json\` contains:

\`\`\`json
{
  "summary": "What you did and why. Next steps.",
  "artifacts": [
    { "type": "next_steps", "label": "Next steps", "content": "..." }
  ],
  "changeRationales": [
    {
      "label": "Short reviewer title",
      "file_path": "path/to/file.ts",
      "summary": "What changed.",
      "why": "Why it changed.",
      "impact": "Behavioral impact.",
      "hunks": [{"header": "@@ -10,6 +10,14 @@"}]
    }
  ]
}
\`\`\`

Supported artifact types: \`next_steps\`, \`test_results\`, \`migration\`, \`note\`, \`url\`, \`decision\`.

## Creating new tickets from an agent runtime

Most agents are handed a ticket ID and attach immediately. When you need to create tickets
yourself (for example to capture follow-up work), use \`create\` for drafts and \`spawn\` when
you want to start execution immediately.

\`\`\`bash
# Standalone draft, project auto-resolved from cwd
ovld protocol create --agent claude-code \\
  --objective "Capture follow-up work from this repository"

# Follow-up draft linked to the current ticket
ovld protocol create --agent claude-code \\
  --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --objective "Write migration notes for the deprecated endpoint"

# Create and attach in one call
ovld protocol spawn --agent claude-code \\
  --objective "Implement feature X" --priority high
\`\`\`
      `}
    </DocsMarkdownPage>
  );
}
