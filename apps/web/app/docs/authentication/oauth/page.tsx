import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'OAuth'
};

export default function OAuthPage() {
  return (
    <DocsMarkdownPage
      title="OAuth"
      lead="OAuth is the interactive, browser-based login. Use it for Overlord Desktop, for the CLI on the same machine, and for cloud agents whose runtime can complete an OAuth consent flow over MCP."
    >
      {`
## When to use OAuth

OAuth is the right choice when a human can complete a browser consent screen and the surface runs somewhere trusted:

- Overlord Desktop on your own machine.
- The CLI running on the same machine as Desktop (it reuses Desktop's session).
- Cloud agent runtimes that natively support OAuth connectors (Claude custom connectors, Cursor cloud, and similar).

If the surface is headless, runs in a container away from Desktop, or sits behind a runtime where OAuth is unreliable, use an [agent token](/docs/authentication/agent-token) instead.

## Desktop app

Overlord Desktop signs you in with OAuth on first launch and stores the resulting session locally.

1. Launch Overlord Desktop.
2. Complete the browser login and consent screen.
3. The session is saved to the shared local credential store and refreshes automatically.

Because Desktop writes to the shared credential store, any CLI running on the same machine can reuse the same session — you do not have to log in twice.

## CLI

On the same machine as Desktop, the CLI resolves Desktop's shared OAuth credentials automatically. If you are not running Desktop, log in directly:

\`\`\`bash
npm install -g @overlord-ai/cli
ovld auth login
\`\`\`

\`ovld auth login\` opens your browser, runs the OAuth device flow (falling back to a loopback redirect when device authorization is unavailable), and saves the session locally. Then verify:

\`\`\`bash
ovld auth status
\`\`\`

Login stores your identity only — the CLI is organization-agnostic and keeps no default organization. \`ovld auth status --verbose\` lists every organization you belong to. Each command resolves its organization from the ticket id (e.g. \`1:1263\`), an explicit \`--organization-id\`, or your membership, and commands such as \`ovld add-cwd\`, \`ovld create\`, and \`ovld tickets list\` span all of your organizations.

Optional flags:

- \`--organization-id <id>\` — scope a non-ticket command to a single organization. It is validated against your membership but no longer stored as a default.

If a call later returns \`401\`, repair the shared credentials before logging in again:

\`\`\`bash
ovld auth repair
ovld auth login   # only if repair does not resolve it
\`\`\`

> OAuth sessions are tied to the local machine. If the CLI runs in a separate container or execution target from where Desktop is installed, the shared session is not available there — use an [agent token](/docs/authentication/agent-token) instead.

## MCP

For cloud or hosted agents that connect over the [MCP server](/docs/surfaces/mcp-server), OAuth works whenever the runtime can drive a connector login flow.

1. Open your agent's MCP / connector settings and add a new server.
2. Paste the Overlord MCP URL (copy it from **Settings → Agents & MCP**) as the server URL.
3. Start the connector login flow and complete the OAuth consent screen.
4. If your platform enforces an outbound domain allowlist, add the Overlord domains so the connector can reach the server:

\`\`\`text
ovld.ai
*.ovld.ai
\`\`\`

OAuth keeps the cloud agent scoped to your account and organization without distributing a long-lived secret. If the runtime cannot reliably complete the OAuth flow, switch that agent to the [agent token approach](/docs/authentication/agent-token).

## Related pages

- [Authentication overview](/docs/authentication)
- [Agent tokens](/docs/authentication/agent-token)
- [CLI](/docs/surfaces/cli)
- [Desktop app](/docs/surfaces/desktop-app)
- [MCP server](/docs/surfaces/mcp-server)
      `}
    </DocsMarkdownPage>
  );
}
