import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Context'
};

export default function ContextPage() {
  return (
    <DocsMarkdownPage
      title="Context"
      lead="Shared context lets useful facts survive across agent sessions."
    >
      {`
## What it is

Ticket-specific shared context stores facts that should stay available when work pauses or moves between agents.

## Why it helps

It reduces repeated explanation and makes resumed work more reliable.

## Typical use cases

- notes a previous agent discovered
- constraints that should remain visible
- decisions that should carry into the next session

## Related pages

- [Updates & questions](/docs/workflow/updates)
- [Deliver](/docs/protocol/deliver)
      `}
    </DocsMarkdownPage>
  );
}
