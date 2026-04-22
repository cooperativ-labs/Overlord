import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Ask'
};

export default function AskPage() {
  return (
    <DocsMarkdownPage title="Ask" lead="Ask is the blocking-question path.">
      {`
## When to use it

Use ask when the agent cannot move forward safely without a human answer.

## What happens next

The question is posted back into the ticket so the user can respond in context.

## Workflow rule

When an agent is blocked, it should stop after asking and wait for the human reply rather than guessing.

## Related: permission-request

For a narrower case — the agent wants to run a specific tool or command and needs explicit approval — the protocol offers \`ovld protocol permission-request\`. It notifies the reviewer and pauses the agent until a decision is made, without changing ticket status the way \`ask\` does.

## Related pages

- [Updates & questions](/docs/workflow/updates)
- [Deliver](/docs/protocol/deliver)
      `}
    </DocsMarkdownPage>
  );
}
