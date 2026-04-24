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

## Desktop and CLI login

Desktop and CLI workflows use a shared OAuth session stored locally after Overlord Desktop login or \`ovld auth login\`.

OAuth protocol requests include an explicit organization scope.

## MCP access

Cloud or hosted agents should use OAuth-based access through the MCP server when supported. Legacy agent tokens remain a compatibility fallback for non-interactive runtimes, CI, and remote shells that cannot complete OAuth login.

## Local protocol routes

Local Electron-hosted protocol routes can rely on an additional local secret when configured.

## Related pages

- [Protocol reference](/docs/protocol)
- [MCP server](/docs/surfaces/mcp-server)
      `}
    </DocsMarkdownPage>
  );
}
