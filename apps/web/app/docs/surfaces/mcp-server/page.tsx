import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'MCP Server'
};

export default function McpServerPage() {
  return (
    <DocsMarkdownPage
      title="MCP Server"
      lead="The MCP server gives cloud or hosted agents a standard way to interact with Overlord tickets."
    >
      {`
## What it does

The MCP server exposes the ticket workflow to remote agent runtimes without requiring the desktop app.

Use it for:

- listing and reading tickets
- creating tickets from agent workflows
- posting updates and deliverables
- integrating Overlord into a broader orchestration system

## Primary audience

- cloud agents
- headless runtimes
- connector-style integrations
- external automation that needs ticket access

## Related pages

- [Protocol reference](/docs/protocol)
- [Authentication](/docs/security/authentication)
      `}
    </DocsMarkdownPage>
  );
}
