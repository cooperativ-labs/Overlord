import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Workflow'
};

export default function WorkflowPage() {
  return (
    <DocsMarkdownPage
      title="Workflow"
      lead="Overlord is built around objectives, tickets, and projects. Objectives are the unit of work; tickets group shared-context objectives into a higher-level goal; projects group related code and resources."
    >
      {`
## The normal flow

1. A user creates a ticket.
2. The user adds the first objective to describe the next concrete task.
3. The objective becomes the structured prompt and execution record for that agent pass.
4. The user can attach files to the objective and choose which agent should execute it.
5. The user sends it to an agent in the tool they already use.
6. The agent works and reports progress back to Overlord.
7. The user reviews updates, answers questions, and evaluates deliverables.
8. The ticket stays as the durable record of the work, and the user can add another objective if a follow-up pass is needed.

## Tickets and objectives

Think of the ticket as the durable container and each objective as the next instruction in that same work thread.

That lets users keep planning, implementation, review, and follow-up passes together without opening a new chat or restating the full history.

## What this model gives you

- a shared system of record
- less prompt drift across tools
- clearer handoffs between human and agent work
- a reliable review surface

## Related pages

- [Tickets](/docs/workflow/tickets)
- [Objectives](/docs/workflow/objectives)
- [Agent execution](/docs/workflow/agent-execution)
- [Terminal & IDE](/docs/workflow/terminal-and-ide)
- [Execution targets & resources](/docs/workflow/execution-targets)
- [File changes & checkpoints](/docs/workflow/file-changes)
- [Updates & questions](/docs/workflow/updates)
- [Review & delivery](/docs/workflow/review)
      `}
    </DocsMarkdownPage>
  );
}
