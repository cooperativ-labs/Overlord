import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Authentication'
};

export default function AuthenticationPage() {
  return (
    <DocsMarkdownPage
      title="Authentication"
      lead="Different Overlord surfaces use different credentials, but the goal is always the same: keep access scoped and auditable."
    >
      {`
## Web app login

The web app uses a normal Supabase Auth session for signed-in users.

## Agent tokens

Desktop and CLI workflows use agent tokens that are scoped to a user and organization.

These tokens are sensitive and should be treated as secrets.

## MCP access

Cloud or hosted agents can use OAuth-based access through the MCP server, and legacy flows can still use agent tokens when needed.

## Local protocol routes

Local Electron-hosted protocol routes can rely on an additional local secret when configured.

## Related pages

- [Protocol reference](/docs/protocol)
- [MCP server](/docs/surfaces/mcp-server)
      `}
    </DocsMarkdownPage>
  );
}
