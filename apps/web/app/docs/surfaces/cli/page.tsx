import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'CLI'
};

export default function CliPage() {
  return (
    <DocsMarkdownPage
      title="CLI"
      lead="The ovld CLI is the stable, terminal-first interface for Overlord. Agents and humans use the same commands to attach to tickets, post updates, and deliver work."
    >
      {`
## Install & maintain

\`\`\`bash
# Install or upgrade the CLI
ovld update

# Validate local agent integrations and check for CLI updates
ovld doctor

# Install a local agent integration (claude, codex, cursor, gemini, opencode)
ovld setup <agent>
\`\`\`

## Ticket lifecycle

The everyday commands an agent runs while working on a ticket.

\`\`\`bash
# Attach this session to a ticket
ovld protocol attach --ticket-id <ticket-id>

# Load ticket context without creating a session
ovld protocol load-context --ticket-id <ticket-id>

# Connect this session to an existing ticket by ID
ovld protocol connect --ticket-id <ticket-id>

# Post a progress update
ovld protocol update --session-key <key> --ticket-id <id> \\
  --summary "What you did and why." --phase execute

# Ask a blocking question
ovld protocol ask --session-key <key> --ticket-id <id> \\
  --question "Specific question for the reviewer."

# Request permission to use a tool
ovld protocol permission-request --session-key <key> --ticket-id <id> \\
  --tool Bash --reason "Needed to run the test suite."

# Deliver final results
ovld protocol deliver --session-key <key> --ticket-id <id> \\
  --summary "Narrative of what changed." \\
  --change-rationales-json '[...]'
\`\`\`

## Creating tickets from the CLI

\`\`\`bash
# Resolve which Overlord project matches the current directory
ovld protocol discover-project

# Create a draft ticket (does not start execution)
ovld protocol create --agent claude-code \\
  --objective "Capture follow-up work from this repository"

# Create a ticket and attach immediately to start execution
ovld protocol prompt --agent claude-code \\
  --objective "Implement feature X" --priority medium

# Interactive ticket search and agent launch
ovld attach
\`\`\`

## Context & artifacts

\`\`\`bash
# Read / write shared ticket context
ovld protocol read-context --session-key <key> --ticket-id <id>
ovld protocol write-context --session-key <key> --ticket-id <id> \\
  --key "key" --value '"json-value"'

# Upload and download objective attachments
ovld protocol attachment-upload-file --session-key <key> --ticket-id <id> \\
  --objective-id <objective-id> --file ./spec.pdf --content-type application/pdf
ovld protocol attachment-download-url --session-key <key> --ticket-id <id> \\
  --attachment-id <attachment-id>
\`\`\`

## When to use the CLI

- local repository work
- terminal-driven agent sessions
- human debugging or orchestration from a shell
- CI or scripting, where a desktop app isn't available

## Tips

- Run \`ovld protocol help\` to see the full, up-to-date command list.
- Keep the \`session.sessionKey\` returned by \`attach\` — every follow-up command needs it.
- Use \`ovld doctor\` after upgrades to confirm plugins and the CLI are in sync.

## Related pages

- [Attach](/docs/protocol/attach)
- [Update](/docs/protocol/update)
- [Ask](/docs/protocol/ask)
- [Deliver](/docs/protocol/deliver)
- [Context](/docs/protocol/context)
- [Artifacts](/docs/protocol/artifacts)
      `}
    </DocsMarkdownPage>
  );
}
