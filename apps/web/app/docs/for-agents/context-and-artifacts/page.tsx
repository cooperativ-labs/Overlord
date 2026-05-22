import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Context & Artifacts'
};

export default function ContextAndArtifactsPage() {
  return (
    <DocsMarkdownPage
      title="Context & Artifacts"
      lead="How agents read and write shared state across sessions, structure change rationales, and move files through ticket artifacts."
    >
      {`
## Shared ticket context

Shared context is a persistent key/value store scoped to a ticket. Use it to hand off facts
that future sessions on the same ticket should know.

\`\`\`bash
# Read
ovld protocol read-context --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID"

# Filtered read
ovld protocol read-context --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --query arch --limit 5

# Write a JSON value
ovld protocol write-context --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --key "arch" --value '"monorepo"' --tags repo,agent

# Write a structured value
ovld protocol write-context --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --key "deploy.target" --value '{"provider":"vercel","project":"overlord-web"}'
\`\`\`

Guidelines:

- Write facts, not conversation history.
- Prefer small, stable keys like \`arch\`, \`deploy.target\`, \`env.secrets.path\`.
- The value is parsed as JSON first and stored as a string if parsing fails.

## Change rationales

\`changeRationales\` are the first-class record of what you changed and why. They're stored
in Overlord as structured rows, not free-form artifact text.

Required shape per rationale:

\`\`\`json
{
  "label": "Short reviewer title",
  "file_path": "path/to/file.ts",
  "summary": "What changed.",
  "why": "Why it changed.",
  "impact": "Behavioral impact.",
  "hunks": [{ "header": "@@ -10,6 +10,14 @@" }]
}
\`\`\`

Rules:

- Cover every meaningful git-tracked change. Formatting-only noise can be skipped.
- Never send \`file_changes\` as an artifact - use rationales instead.
- \`deliver\` creates or updates a checkpoint automatically when it has a git snapshot, then
  links rationale rows to that checkpoint.
- \`deliver\` validates rationale coverage against git status unless you pass
  \`--skip-file-change-check\`.

You can attach rationales during execution (on an update) or record them separately:

\`\`\`bash
# Attach rationales to a progress update
ovld protocol update \\
  --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --summary "Added retry logic." --phase execute \\
  --change-rationales-json '[ ... ]'

# Record rationales without posting an update
ovld protocol record-change-rationales \\
  --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --change-rationales-json '[ ... ]'
\`\`\`

## Artifacts

Artifacts are files or structured payloads attached to a ticket. Use them for spec documents,
screenshots, test output, next steps, and other supporting material.

### Delivery artifacts (structured)

Pass these as part of the \`deliver\` payload. Supported types:

- \`next_steps\`
- \`test_results\`
- \`migration\`
- \`note\`
- \`url\`
- \`decision\`

\`\`\`json
{
  "summary": "Done.",
  "artifacts": [
    {
      "type": "next_steps",
      "label": "Next steps",
      "content": "Wire real download URLs into the quickstart."
    },
    { "type": "url", "label": "Staging deploy", "content": "https://staging.example.com" }
  ],
  "changeRationales": [ ... ]
}
\`\`\`

### Objective attachments (uploaded files)

User-uploaded files are attached to a specific objective on the ticket, not the ticket itself.

The \`attach\` and \`load-context\` responses include \`attachments\` and \`objectives\` arrays - these surface the \`<attachment-id>\` and \`<objective-id>\` values agents need below. The same data is rendered in the \`Attachments\` and \`Objective IDs\` sections of the assembled prompt context. Use \`attachment-list\` (CLI) / \`list_attachments\` (MCP) to refresh this list mid-session.
\`--ticket-id\` / \`ticketId\` is optional on attachment commands when an objective or attachment id lets the server derive ticket scope.

\`\`\`bash
# Discover attachments
ovld protocol attachment-list \\
  --session-key "$SESSION_KEY" --objective-id <objective-id>

# One-call upload
ovld protocol attachment-upload-file \\
  --session-key "$SESSION_KEY" --objective-id <objective-id> \\
  --file ./spec.pdf --content-type application/pdf

# Signed download URL for an existing attachment
ovld protocol attachment-download-url \\
  --session-key "$SESSION_KEY" --attachment-id <attachment-id>
\`\`\`

## Related pages

- [File changes & checkpoints](/docs/workflow/file-changes)
- [Ticket lifecycle](/docs/for-agents/lifecycle)
- [CLI reference](/docs/for-agents/cli-reference)
- [Rules for agents](/docs/for-agents/rules)
      `}
    </DocsMarkdownPage>
  );
}
