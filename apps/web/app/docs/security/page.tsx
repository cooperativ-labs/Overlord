import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Security'
};

export default function SecurityPage() {
  return (
    <DocsMarkdownPage
      title="Security"
      lead="Overlord keeps local repository contents on your machine unless you intentionally put information into a ticket."
    >
      {`
## Main boundaries

- repository contents are not sent to Overlord just because you connect a repo
- ticket content is stored so Overlord can coordinate work
- anything an agent writes into a ticket becomes part of the durable record

## What to keep in mind

Treat ticket content as intentional shared record data.

## Related pages

- [Data boundaries](/docs/security/data-boundaries)
- [Authentication](/docs/security/authentication)
      `}
    </DocsMarkdownPage>
  );
}
