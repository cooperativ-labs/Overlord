import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Attach'
};

export default function AttachPage() {
  return (
    <DocsMarkdownPage title="Attach" lead="Attach binds an agent session to a specific ticket.">
      {`
## What attach does

Attaching establishes the session identity that later updates, questions, and delivery events use.

## Why it matters

It gives Overlord a durable link between:

- the ticket
- the agent session
- the work that follows

## Practical rule

Attach first, then use the same session key for subsequent protocol calls.

## Related pages

- [Update](/docs/protocol/update)
- [Ask](/docs/protocol/ask)
- [Deliver](/docs/protocol/deliver)
      `}
    </DocsMarkdownPage>
  );
}
