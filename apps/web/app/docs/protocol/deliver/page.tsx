import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Deliver'
};

export default function DeliverPage() {
  return (
    <DocsMarkdownPage title="Deliver" lead="Deliver is the final handoff back into the ticket.">
      {`
## What delivery should include

Final delivery events can include:

- file change summaries
- notes
- next steps
- links
- uploaded files or artifacts

## The purpose

Delivery turns the end of the agent run into a durable, reviewable record rather than a terminal-only result.

## Related pages

- [Artifacts](/docs/protocol/artifacts)
- [Review & delivery](/docs/workflow/review)
      `}
    </DocsMarkdownPage>
  );
}
