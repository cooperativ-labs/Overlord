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
