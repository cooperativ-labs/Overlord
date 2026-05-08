import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'CLI'
};

export default function CliPage() {
  return (
    <DocsMarkdownPage
      title="CLI"
      lead="The ovld CLI is the terminal-first interface for Overlord. Use it to install agent plugins, manage your setup, launch tickets, and work with Overlord from the command line."
    >
      {`
## Install

\`\`\`bash
# Install the CLI globally via npm
npm install -g @overlord-ai/cli

# Or try without installing
npx @overlord-ai/cli --help
\`\`\`

## Authentication

\`\`\`bash
# Log in to your Overlord account
ovld auth login

# Log out
ovld auth logout
\`\`\`

## Setup & maintenance

\`\`\`bash
# Install a local agent integration (claude, codex, cursor, gemini, opencode)
ovld setup <agent>

# Validate local agent integrations and check for CLI updates
ovld doctor

# Upgrade the CLI to the latest version
ovld update
\`\`\`

## Working with tickets

\`\`\`bash
# Interactively search for a ticket and launch the agent
ovld attach

# Launch the desktop app
ovld open
\`\`\`

## When to use the CLI

- Installing and configuring agent plugins on a new machine
- Launching tickets from the terminal without the desktop app
- Verifying your local setup after an upgrade
- Headless or CI environments where the desktop app is unavailable

## Tips

- Run \`ovld --help\` or \`ovld <command> --help\` to see available options.
- Use \`ovld doctor\` after upgrades to confirm plugins and the CLI are in sync.
- The desktop app and CLI share the same credentials — log in once and both work.

## Related pages

- [Agent Plugins](/docs/agent-plugins)
- [Desktop App](/docs/surfaces/desktop-app)
- [Protocol Reference](/docs/protocol)
      `}
    </DocsMarkdownPage>
  );
}
