import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Update'
};

export default function UpdatePage() {
  return (
    <DocsMarkdownPage
      title="Update"
      lead="Update is how the agent keeps the ticket current when there is meaningful progress to record."
    >
      {`
## What updates carry

Updates usually include:

- progress summaries
- status changes
- notes about what changed
- activity events when something meaningful happened

If you only need to prove the session is still alive during a long-running mechanical step, use
\`heartbeat\` instead of a narrative update so the activity feed stays clean.

## Why they exist

Updates keep the human reviewer informed without requiring them to sit in the terminal session.

## Related pages

- [Attach](/docs/protocol/attach)
- [Heartbeat](/docs/protocol/heartbeat)
- [Ask](/docs/protocol/ask)
- [Context](/docs/protocol/context)
      `}
    </DocsMarkdownPage>
  );
}
