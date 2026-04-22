import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Protocol Reference'
};

export default function ProtocolPage() {
  return (
    <DocsMarkdownPage
      title="Protocol Reference"
      lead="The protocol is the stable terminal contract agents use to work with tickets."
    >
      {`
## Core commands

The protocol surface currently includes:

- auth-status
- discover-project
- attach
- connect
- load-context
- create
- spawn
- update
- record-change-rationales
- ask
- permission-request
- read-context
- write-context
- deliver
- artifact upload and download helpers

## What these commands do

They let an agent resolve the right project, bind to a ticket, report progress, persist file-level rationale, share reusable context, manage artifacts, ask for help, request tool permission, and return final work in a structured way.

## create vs. spawn

Both create tickets from an agent session, but they differ in intent:

- \`create\` produces a draft ticket without attaching. This is the default path for capturing follow-up work from within an existing session.
- \`spawn\` creates a ticket in \`execute\` status and immediately attaches the current session. Use it when the agent should start work on the new ticket right away.

## Related pages

- [Attach](/docs/protocol/attach)
- [Update](/docs/protocol/update)
- [Ask](/docs/protocol/ask)
- [Deliver](/docs/protocol/deliver)
- [Context](/docs/protocol/context)
- [Artifacts](/docs/protocol/artifacts)
      `}
    </DocsMarkdownPage>
  );
}
