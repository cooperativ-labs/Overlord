import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Objectives'
};

export default function ObjectivesPage() {
  return (
    <DocsMarkdownPage
      title="Objectives"
      lead="Objectives are the concrete instructions inside a ticket. When an agent runs, it is acting on an objective—the scoped unit of work Overlord hands to the agent."
    >
      {`
## Objectives vs tickets

A **ticket** is the durable container: title, history, status, reviewers, and everything that happened on that thread of work.

An **objective** is the next slice of work inside that ticket: what should happen *now*, in language an agent can execute without guessing.

You can add more objectives over time instead of opening a new chat or duplicating context. Planning, implementation, review passes, and cleanup can all live on one ticket as separate objectives.

## What the agent actually runs

Launch and protocol context are tied to the **active objective**. That objective is the unit of work the agent receives—the prompt body, attachments, and objective id in context all refer to that slice.

The ticket title and metadata still matter for humans scanning the board, but the agent’s instructions live at the objective level.

## What an objective can carry

Typical fields and behaviors include:

- the instruction text (what to build, fix, or research)
- status for that slice of work (for example executing while an agent has it)
- attachments scoped to that instruction
- agent and model choice for that pass

Attachments belong to a specific objective so files stay tied to the task they support.

## When to add a new objective

Add another objective when the scope changes in a meaningful way, for example:

- the first pass was “spike a design” and the next pass is “implement it”
- implementation is done and you want a dedicated review or hardening pass
- follow-up work appeared after delivery and should stay on the same ticket record

You do not need a new ticket for every follow-up if the work still belongs to the same story.

## Related pages

- [Tickets](/docs/workflow/tickets)
- [Workflow overview](/docs/workflow)
- [Agent execution](/docs/workflow/agent-execution)
- [Context & artifacts](/docs/for-agents/context-and-artifacts)
      `}
    </DocsMarkdownPage>
  );
}
