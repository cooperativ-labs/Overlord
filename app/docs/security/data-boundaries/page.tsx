import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Data Boundaries'
};

export default function DataBoundariesPage() {
  return (
    <DocsMarkdownPage
      title="Data Boundaries"
      lead="The important split is between local repository data and ticket data."
    >
      {`
## What stays local

The content of your repository files stays on your machine unless you or your agent explicitly put information into a ticket.

## What Overlord stores

Overlord stores ticket content and ticket-related updates, including:

- plans
- summaries
- questions
- deliverables
- proposed engineering approaches

## The practical rule

If it is written into the ticket, assume it is part of the persistent record for that work.

## Related pages

- [Security overview](/docs/security)
- [Authentication](/docs/security/authentication)
      `}
    </DocsMarkdownPage>
  );
}
