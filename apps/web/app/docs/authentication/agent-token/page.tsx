import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Agent Token'
};

export default function AgentTokenPage() {
  return (
    <DocsMarkdownPage
      title="Agent Token"
      lead="An agent token is a durable, per-user credential (prefixed oat_) that authenticates agents and the CLI without a browser flow. Use it for cloud agents over MCP and for the CLI when it runs separately from Overlord Desktop."
    >
      {`
## Create a token

Agent tokens are managed in the web app and Overlord Desktop.

1. Open **Settings → Agent Tokens**.
2. Enter a label (for example \`Claude Cloud\` or \`Production\`) and create the token.
3. Copy the token immediately — it is shown only once and starts with \`oat_\`.

Tokens never expire on their own. Revoke a token from the same page when you no longer need it; revocation takes effect immediately.

## MCP

Use an agent token for cloud or hosted agents over the [MCP server](/docs/surfaces/mcp-server) when OAuth is not reliable in that runtime (for example Claude Code or other headless environments).

### Set the environment variables

Add both variables to the agent runtime environment. Copy your MCP URL from **Settings → Agents & MCP**:

\`\`\`bash
OVERLORD_AGENT_TOKEN=<paste oat_ token>
OVERLORD_MCP_URL=<your Overlord MCP URL>
\`\`\`

The organization is derived from the token's membership. To pin a different default, also set \`OVERLORD_ORGANIZATION_ID=<id>\`; ticket-scoped operations still infer the organization from ticket ids such as \`1:1263\`.

### Whitelist domains in cloud environments

If your platform enforces an outbound domain allowlist, the agent runtime must be allowed to reach Overlord. Add both the apex domain and its subdomains:

\`\`\`text
ovld.ai
*.ovld.ai
\`\`\`

Without the allowlist entry, the runtime can hold a valid token but still fail to connect because outbound requests to the MCP URL are blocked.

## CLI

Use an agent token when the CLI runs in a **separate container or execution target** from where Overlord Desktop is installed. In that case there is no shared Desktop OAuth session to reuse, so the CLI needs its own durable credential.

There are two ways to provide it.

### Persist it with the CLI

Save the token once and the CLI uses it for every protocol command — no env vars and no Desktop required:

\`\`\`bash
npm install -g @overlord-ai/cli
ovld auth login --token <oat_ token>
ovld auth status
\`\`\`

To stop using it:

\`\`\`bash
ovld auth logout
\`\`\`

### Provide it via environment variables

For ephemeral containers and CI runners, set the token (and host) in the environment instead of persisting it. Every \`ovld protocol\` subcommand honors these fallbacks:

\`\`\`bash
OVERLORD_AGENT_TOKEN=<oat_ token>   # durable per-user token; best for headless/CI
OVERLORD_URL=<your Overlord URL>    # API host
OVERLORD_ORGANIZATION_ID=<id>       # optional; needed for UUID ticket ids and non-ticket commands
\`\`\`

The same domain allowlisting applies: if the container restricts outbound traffic, allow \`ovld.ai\` and \`*.ovld.ai\` so the CLI can reach the protocol API.

## Related pages

- [Authentication overview](/docs/authentication)
- [OAuth](/docs/authentication/oauth)
- [CLI](/docs/surfaces/cli)
- [Agent CLI reference](/docs/for-agents/cli-reference)
- [MCP server](/docs/surfaces/mcp-server)
      `}
    </DocsMarkdownPage>
  );
}
