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

The protocol surface centers on a small set of actions:

- attach
- update
- ask
- deliver
- context
- artifacts

## What these commands do

They let an agent bind to a ticket, report progress, ask for help, and return final work in a structured way.

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
