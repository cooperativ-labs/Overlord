import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Web App'
};

export default function WebAppPage() {
  return (
    <DocsMarkdownPage
      title="Web App"
      lead="The web app is the shared control center for tickets and projects."
    >
      {`
## What it does

The web app is where you:

- create and edit tickets
- organize work by project
- review ticket activity and artifacts
- answer agent questions
- manage account settings and connected agents

## Why it matters

The web app gives everyone a common view of the work without forcing them into a terminal session or a specific agent UI.

## Common tasks

- turning a request into a ticket
- watching live progress from an agent
- reviewing deliverables before approval
- checking account, auth, and agent settings

## Related pages

- [Desktop app](/docs/surfaces/desktop-app)
- [Workflow overview](/docs/workflow)
- [Security and authentication](/docs/security/authentication)
      `}
    </DocsMarkdownPage>
  );
}
