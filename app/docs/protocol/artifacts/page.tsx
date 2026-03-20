import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Artifacts'
};

export default function ArtifactsPage() {
  return (
    <DocsMarkdownPage
      title="Artifacts"
      lead="Artifacts are structured outputs attached to a ticket."
    >
      {`
## Examples

Agents can attach:

- file change summaries
- notes
- next steps
- links
- uploaded files

## Why artifacts matter

They make it easier to review and revisit the work than digging through raw logs.

## Related pages

- [Deliver](/docs/protocol/deliver)
- [Review & delivery](/docs/workflow/review)
      `}
    </DocsMarkdownPage>
  );
}
