import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Integrations'
};

export default function IntegrationsPage() {
  return (
    <DocsMarkdownPage
      title="Integrations"
      lead="Connect Overlord to the tools your team already uses."
    >
      {`
## Available integrations

- [Everhour](/docs/integrations/everhour) — time tracking synced to your tickets and projects
      `}
    </DocsMarkdownPage>
  );
}
