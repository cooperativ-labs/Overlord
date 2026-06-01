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
# Install a local agent integration (claude, codex, cursor, antigravity, opencode)
ovld setup <agent>

# Launch a ticket in Antigravity (replaces deprecated Gemini CLI)
ovld launch antigravity --ticket-id <ticket_id>

# Validate local agent integrations and check for CLI updates
ovld doctor

# Upgrade the CLI to the latest version
ovld update
\`\`\`

## Working with tickets

\`\`\`bash
# Interactively search for a ticket and launch the agent
ovld attach

# Launch a specific ticket in an agent (manual / fallback when no runner)
ovld launch cursor --ticket-id <ticket_id> --working-directory <path>
\`\`\`

## Launch an agent in one line

\`ovld <agent> "<prompt>"\` creates a ticket from your prompt — inferring the project from the current directory — and immediately launches the agent on it. You get all of Overlord's tracking without opening the desktop or web UI.

\`\`\`bash
# Built-in agent; project inferred from cwd, model + effort applied to the ticket
ovld claude "refactor the auth middleware" --model opus --thinking high

# Forward native agent flags verbatim after a standalone --
ovld codex "investigate the memory leak" -- --search --full-auto

# Explicit project + human-review ticket
ovld cursor "tidy the dashboard styles" --project-id <uuid> --for-human

# Long prompts can be piped in
echo "summarize today's diffs" | ovld claude

# Launch one of your custom agents by id
ovld ollama-claude "summarize today's diffs" --model qwen2.5-coder
\`\`\`

- Built-in agents must have an installed connector (\`ovld setup <agent>\`); pass \`--allow-uninstalled\` to override.
- Overlord flags (\`--model\`, \`--thinking\`, \`--project-id\`, \`--personal\`, \`--for-human\`, \`--priority\`, \`--title\`, \`--working-directory\`, repeatable \`--flag\`, \`--pre-command\`, and the remote/SSH flags) are consumed by the CLI; \`--pre-command\` runs through your shell before the agent binary, and everything after \`--\` is forwarded to the agent binary.
- If no project resolves from the current directory, register it first with \`ovld add-cwd\` or pass \`--project-id\`.

## Terminal runner

When the web or desktop app enqueues an execution request (Run or auto-advance), a local **runner** claims the row and spawns \`ovld launch\` for you. The backend does not open terminals.

\`\`\`bash
# Run continuously — claim and launch queued requests (polls every 3s by default)
ovld runner start

# Process one queued request, then exit
ovld runner once

# Show this machine's device record plus visible active queue rows
ovld runner status

# Clear one active queue row by objective id
ovld runner clear <objective-uuid>

# Clear every active queue row visible to the caller
ovld runner clear-all
\`\`\`

Common options: \`--poll-interval-ms\`, \`--device-fingerprint\` (or \`OVERLORD_DEVICE_FINGERPRINT\`), \`--project-id\`.

See [Agent Execution & Runner](/docs/workflow/agent-execution) for architecture diagrams and the full request lifecycle.

## When to use the CLI

- Installing and configuring agent plugins on a new machine
- Launching tickets from the terminal without the desktop app
- Running \`ovld runner start\` so Run / auto-advance opens agents automatically
- Verifying your local setup after an upgrade
- Headless or CI environments where the desktop app is unavailable

## Tips

- Run \`ovld --help\` or \`ovld <command> --help\` to see available options.
- Use \`ovld doctor\` after upgrades to confirm plugins and the CLI are in sync.
- The desktop app and CLI share the same credentials — log in once and both work.

## Related pages

- [Agent Execution & Runner](/docs/workflow/agent-execution)
- [Agent Plugins](/docs/agent-plugins)
- [Desktop App](/docs/surfaces/desktop-app)
- [Protocol Reference](/docs/protocol)
      `}
    </DocsMarkdownPage>
  );
}
