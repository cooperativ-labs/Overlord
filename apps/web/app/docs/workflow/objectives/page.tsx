import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Objectives'
};

export default function ObjectivesPage() {
  return (
    <DocsMarkdownPage
      title="Objectives"
      lead="Objectives are the unit of work in Overlord: the prompt, agent choice, checkpoint, attachments, and execution state for one agent pass."
    >
      {`
## Objectives vs tickets

A **ticket** is the higher-level goal: a feature, bug fix, investigation, or review thread composed of objectives that share context.

An **objective** is the next slice of work inside that ticket: the prompt for what should happen *now*, the agent/model choice for the pass, the checkpoint, and the execution record.

You can add more objectives over time instead of opening a new chat or duplicating context. Planning, implementation, review passes, and cleanup can all live on one ticket as separate objectives.

## What the agent actually runs

Launch and protocol context are tied to the **active objective**. That objective is the unit of work the agent receives—the prompt body, attachments, checkpoint, and objective id in context all refer to that slice.

The ticket title and metadata still matter for humans scanning the board, but the agent’s instructions live at the objective level.

## What an objective can carry

Typical fields and behaviors include:

- the instruction text (what to build, fix, or research)
- status for that slice of work (for example executing while an agent has it)
- attachments scoped to that instruction
- agent and model choice for that pass
- the checkpoint that anchors review and file-change rationale

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
