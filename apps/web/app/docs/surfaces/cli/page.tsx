import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'CLI'
};

export default function CliPage() {
  return (
    <DocsMarkdownPage
      title="CLI"
      lead="The CLI gives terminal-first workflows a stable way to connect to Overlord tickets."
    >
      {`
## What the CLI handles

Agents use the CLI to:

- discover the project that matches the current working directory
- attach a session to a ticket
- create lightweight ticket sessions without full context
- load ticket context without creating a session
- create a draft follow-up ticket without attaching
- spawn a follow-up ticket and attach to it immediately
- fetch the latest ticket context
- post progress updates
- record structured change rationales
- ask blocking questions
- request tool permission from the human reviewer
- read and write shared ticket context
- deliver final results
- install or update the CLI with \`ovld update\`
- upload and download ticket artifacts
- install local agent integrations with \`ovld setup <agent>\`
- validate local agent integrations and check for CLI updates with \`ovld doctor\`

## Why it exists

The CLI gives agents one stable interface for ticket work from the terminal, no matter which agent runtime is executing the task.

## When to use it

- local repository work
- terminal-driven agent sessions
- human debugging or orchestration from a shell

## Related pages

- [Attach](/docs/protocol/attach)
- [Update](/docs/protocol/update)
- [Deliver](/docs/protocol/deliver)
      `}
    </DocsMarkdownPage>
  );
}
