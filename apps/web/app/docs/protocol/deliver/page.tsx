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

## Large payloads

Use \`--payload-json\` when the full delivery object fits inline on the command line.

Use \`--payload-file -\` to stream a full delivery JSON payload on stdin. This keeps summaries, artifacts, and change rationales in one structured JSON document without creating a temporary delivery file that needs cleanup.

File-backed payloads are still supported when stdin is not available, but they should be treated as ephemeral scratch data under 
        .overlord /tmp

## Related pages

      - [Artifacts](/docs/protocol/artifacts)
      - [Review & delivery](/docs/workflow/review)
      `}
    </DocsMarkdownPage>
  );
}
