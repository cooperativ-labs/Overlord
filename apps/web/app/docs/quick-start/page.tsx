import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Quick Start'
};

export default function QuickStartPage() {
  return (
    <DocsMarkdownPage
      title="Quick Start"
      lead="Get set up in a few minutes: create your Overlord account, install the desktop app, and connect it to the agent you already use."
    >
      {`
## 1. Create an account

Sign up at [ovld.ai/signup](https://www.ovld.ai/signup) and finish onboarding in the web app. Your account hosts your projects, tickets, and delivery history.

## 2. Download the desktop app

The desktop app is what launches agents locally, follows your repositories, and streams updates back into Overlord.

- Download the latest build from the [Downloads page](https://www.ovld.ai/downloads).
- Install it like any native app and sign in with the account you just created.

On first launch, the app walks you through linking a workspace folder and choosing which agents to connect.

## 3. Install the agent plugins

Agents like Claude Code and Codex talk to Overlord through a small plugin. Installing a plugin once lets Overlord launch, attach, and deliver tickets through that agent.

Follow the [Agent plugins guide](/docs/agent-plugins) to install the plugins from Overlord settings, then register them in Claude Code and the Codex desktop app.

## 4. Create your first ticket

With the plugins installed you can create a ticket from the web app, the desktop app, or the CLI. Keep the first one simple — a clear objective and a project is usually enough.

## 5. Launch and review

Launch the ticket from the desktop app. The agent runs in its own terminal, streams updates into Overlord, and waits for you to review the delivery before anything lands.

### Prefer the terminal? Launch in one line

If you live in the terminal, skip the UI entirely. From a registered project directory, \`ovld <agent> "<prompt>"\` creates a ticket from your prompt and launches the agent on it in a single command:

\`\`\`bash
ovld claude "add a health check endpoint" --model opus
\`\`\`

See the [CLI guide](/docs/surfaces/cli#launch-an-agent-in-one-line) for the full flag reference.

### Next steps

- [Agent plugins](/docs/agent-plugins)
- [Product surfaces](/docs/surfaces)
- [Workflow overview](/docs/workflow)
- [Protocol reference](/docs/protocol)
      `}
    </DocsMarkdownPage>
  );
}
