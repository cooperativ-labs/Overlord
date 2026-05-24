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

- Repository contents are NOT sent to Overlord. Overlord uses the linked project folder(s) in three ways 
   - to route agents to the right repository and 
   - to show the local working directory in the desktop Current Changes view
   - to generate a snapshot of this project's deployable surfaces, migration system, codegen steps, tests, and workspace boundaries. You can see this metadata in a given project's settings: Settings > Feed > Repo operations profile
- Ticket content is stored so Overlord can coordinate work
- Anything an agent writes into a ticket becomes part of the durable record and is saved in our database.

## What to keep in mind

Treat ticket content as intentional shared record data.

## Related pages

- [Data boundaries](/docs/security/data-boundaries)
- [Authentication](/docs/security/authentication)
      `}
    </DocsMarkdownPage>
  );
}
