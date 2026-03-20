import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Update'
};

export default function UpdatePage() {
  return (
    <DocsMarkdownPage
      title="Update"
      lead="Update is how the agent keeps the ticket current while work is in progress."
    >
      {`
## What updates carry

Updates usually include:

- progress summaries
- status changes
- notes about what changed
- activity events when something meaningful happened

## Why they exist

Updates keep the human reviewer informed without requiring them to sit in the terminal session.

## Related pages

- [Attach](/docs/protocol/attach)
- [Ask](/docs/protocol/ask)
- [Context](/docs/protocol/context)
      `}
    </DocsMarkdownPage>
  );
}
