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
- an objective
- acceptance criteria
- execution target information
- status and priority
- project assignment
- assigned agent and model
- creator attribution
- read / unread state per reviewer

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
- [Protocol attach](/docs/protocol/attach)
      `}
    </DocsMarkdownPage>
  );
}
