import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Agent Execution'
};

export default function AgentExecutionPage() {
  return (
    <DocsMarkdownPage
      title="Agent Execution"
      lead="Overlord coordinates the work, but the agent still runs in the environment best suited to the task."
    >
      {`
## Execution targets

Depending on the task, the execution target might be:

- a local repository via the desktop app
- a terminal-first CLI session
- a hosted or cloud agent through MCP

## What happens during execution

The agent reads the ticket, works in the repository, and reports back through the ticket workflow.

## Launching without lock-in

Overlord is designed to coordinate Claude Code, Codex, Cursor, Gemini, and other setups instead of replacing them.

## Related pages

- [CLI](/docs/surfaces/cli)
- [MCP server](/docs/surfaces/mcp-server)
- [Updates & questions](/docs/workflow/updates)
      `}
    </DocsMarkdownPage>
  );
}
