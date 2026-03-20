import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Quick Start'
};

export default function QuickStartPage() {
  return (
    <DocsMarkdownPage
      title="Quick Start"
      lead="The shortest path from a task to a reviewed agent delivery is: create a ticket, attach the session, keep updates flowing, and review the result before you move on."
    >
      {`
## 1. Create a project

Projects group related tickets. In the desktop app, you can link a project to a local repository so Overlord can launch work in the right workspace.

## 2. Write a ticket

Keep the ticket focused and specific. A good ticket usually includes:

- a clear objective
- any acceptance criteria you care about
- the execution target or repository context
- any constraints the agent should respect

## 3. Launch the agent

Use the surface that fits the job:

- the desktop app for local repository work
- the CLI for terminal-first work
- the MCP server for cloud or hosted agent integrations

## 4. Track the work

As the agent runs, keep the ticket open and watch for:

- progress updates
- blocking questions
- shared context
- deliverables and file change summaries

## 5. Review the delivery

Before you close out the ticket, inspect the final output and make sure the implementation matches the goal.

### Next steps

- [Learn about the product surfaces](/docs/surfaces)
- [Read the workflow overview](/docs/workflow)
- [Review the protocol reference](/docs/protocol)
      `}
    </DocsMarkdownPage>
  );
}
