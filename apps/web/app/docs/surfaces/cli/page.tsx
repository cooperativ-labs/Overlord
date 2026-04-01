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

- attach a session to a ticket
- fetch the latest ticket context
- post progress updates
- ask blocking questions
- deliver final results
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
