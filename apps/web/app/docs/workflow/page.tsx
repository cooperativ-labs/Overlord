import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Workflow'
};

export default function WorkflowPage() {
  return (
    <DocsMarkdownPage
      title="Workflow"
      lead="Overlord is built around tickets, not chats. The ticket carries the objective, the updates, the review history, and the delivery record."
    >
      {`
## The normal flow

1. A user creates a ticket.
2. The ticket becomes the structured prompt and tracking record.
3. The user sends it to an agent in the tool they already use.
4. The agent works and reports progress back to Overlord.
5. The user reviews updates, answers questions, and evaluates deliverables.
6. The ticket stays as the durable record of the work.

## What this model gives you

- a shared system of record
- less prompt drift across tools
- clearer handoffs between human and agent work
- a reliable review surface

## Related pages

- [Tickets](/docs/workflow/tickets)
- [Agent execution](/docs/workflow/agent-execution)
- [Updates & questions](/docs/workflow/updates)
- [Review & delivery](/docs/workflow/review)
      `}
    </DocsMarkdownPage>
  );
}
