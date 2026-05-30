import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Authentication'
};

export default function AuthenticationPage() {
  return (
    <DocsMarkdownPage
      title="Authentication"
      lead="Overlord supports two ways to authenticate a surface: OAuth and agent tokens. Which one you reach for depends on where the surface runs and whether it can complete an interactive browser flow."
    >
      {`
## The two methods

- **OAuth** — an interactive, browser-based login. The resulting session is shared across Overlord Desktop and the CLI on the same machine, and it expires and refreshes like a normal user session. Best when a human can complete a consent screen and the surface runs on a trusted local machine.
- **Agent token** — a durable, per-user token (prefixed \`oat_\`) created in **Settings → Agent Tokens**. It never expires until you revoke it and requires no browser flow, which makes it the right choice for headless, cloud, or CI environments — and for any CLI that runs separately from Overlord Desktop.

## How to choose

| Situation | Use |
| --- | --- |
| Overlord Desktop on your machine | [OAuth](/docs/authentication/oauth) |
| CLI on the same machine as Desktop | [OAuth](/docs/authentication/oauth) (shared session) |
| CLI in a separate container or remote target | [Agent token](/docs/authentication/agent-token) |
| Cloud / hosted agent over MCP, OAuth-capable runtime | [OAuth](/docs/authentication/oauth) |
| Cloud / hosted agent over MCP, OAuth unreliable | [Agent token](/docs/authentication/agent-token) |

## What every method shares

- Requests are always scoped to an organization. Ticket ids like \`1:1263\` carry the organization id, so ticket-scoped commands infer scope automatically; non-ticket calls fall back to \`--organization-id\` or the stored default.
- Credentials live locally — in shared Desktop/CLI credential files for OAuth, or in environment variables / saved CLI credentials for agent tokens. Overlord never asks you to paste a long-lived secret into the web app.
- If a CLI or protocol call returns \`401\`, run \`ovld auth repair\` first, then \`ovld auth login\` if repair does not resolve it.

## Related pages

- [OAuth](/docs/authentication/oauth)
- [Agent tokens](/docs/authentication/agent-token)
- [MCP server](/docs/surfaces/mcp-server)
- [Security: Authentication](/docs/security/authentication)
      `}
    </DocsMarkdownPage>
  );
}
