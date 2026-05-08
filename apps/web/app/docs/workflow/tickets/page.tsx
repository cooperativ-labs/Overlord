import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Tickets'
};

export default function TicketsPage() {
  return (
    <DocsMarkdownPage title="Tickets" lead="Tickets are the unit of work in Overlord.">
      {`
## What a ticket can hold

A ticket can include:

- a title
- one or more objectives
- acceptance criteria
- execution target information
- status and priority
- project assignment
- creator attribution
- read / unread state per reviewer

## How objectives relate to tickets

The ticket is the durable record for the work. Objectives are the concrete instructions that move that work forward.

In practice, that means:

- the ticket keeps the title, history, review state, and delivery record
- each objective captures the next task for the agent
- users can add another objective later instead of starting a new thread

This is useful when the work needs stages such as plan first, implement second, then review or cleanup.

## Attachments live on objectives

Attachments are added to a specific objective, not to the ticket in the abstract.

That keeps files tied to the instruction they support, such as:

- screenshots for a bug-fix objective
- a spec or brief for an implementation objective
- logs or exports for an investigation objective

In the app, open the draft objective and use the attachment control to upload files. Agents then receive those objective attachments in the ticket context when they attach.

## Users can assign agents per objective

Agent assignment happens on the active objective.

Users can choose the agent and model for the current objective before launching it. That makes it possible to keep one ticket while routing different passes of the work to different agents when needed.

For example, one objective can go to a coding agent for implementation, and a later objective on the same ticket can go to a review-focused agent for a second pass.

## How tickets are created

Tickets can be created from:

- the web or desktop app, including the new-ticket modal on the Kanban board
- the CLI with \`ovld protocol create\` for a draft or \`ovld protocol prompt\` to start execution immediately
- an agent session, as a follow-up captured from the work in progress

## Lifecycle statuses

Tickets move through explicit lifecycle states (draft, next-up, execute, review, deliver, complete, blocked, cancelled) so both humans and agents share the same view of where work stands.

## Why tickets matter

Tickets make prompts easier to reuse, review, and hand off than if they only lived in chat.

## Good ticket shape

Keep the work specific enough that an agent can act on it without guessing, but not so large that the scope becomes unclear.

## Related pages

- [Quick Start](/docs/quick-start)
- [Agent execution](/docs/workflow/agent-execution)
- [Context & artifacts](/docs/for-agents/context-and-artifacts)
- [Protocol attach](/docs/protocol/attach)
      `}
    </DocsMarkdownPage>
  );
}
