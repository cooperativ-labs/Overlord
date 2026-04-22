import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Review & Delivery'
};

export default function ReviewPage() {
  return (
    <DocsMarkdownPage
      title="Review & Delivery"
      lead="The ticket is the review surface and the delivery record."
    >
      {`
## What gets reviewed

Humans can review:

- the final implementation summary
- file change descriptions
- uploaded artifacts
- linked notes and follow-up items
- diff-level change rationales in the desktop app

## Why this matters

The goal is to make the final output easier to review than raw terminal logs.

## Staying current

The Kanban board streams real-time updates as agents work, and tickets track read/unread state per reviewer so it is easy to see what needs attention since you last looked.

## Delivery mindset

The ticket should preserve:

- what was asked
- what happened
- what was delivered
- what still needs follow-up

## Related pages

- [Artifacts](/docs/protocol/artifacts)
- [Deliver](/docs/protocol/deliver)
- [Desktop app](/docs/surfaces/desktop-app)
      `}
    </DocsMarkdownPage>
  );
}
