import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Updates & Questions'
};

export default function UpdatesPage() {
  return (
    <DocsMarkdownPage
      title="Updates & Questions"
      lead="While the agent is working, Overlord keeps humans in the loop through live updates and blocking questions."
    >
      {`
## What can stream into a ticket

As an agent works, tickets can receive:

- session state updates
- progress summaries
- blocking questions
- follow-up messages
- final delivery events

## Shared context

Overlord also supports ticket-specific shared context so useful facts can survive across sessions.

That helps when work pauses, resumes later, or moves between different agent runtimes.

## Human-in-the-loop review

When the agent is blocked, it can ask a question directly in the ticket workflow. The user can respond in the ticket and keep the work moving without losing context.

## Related pages

- [Context](/docs/protocol/context)
- [Ask](/docs/protocol/ask)
- [Review & delivery](/docs/workflow/review)
      `}
    </DocsMarkdownPage>
  );
}
