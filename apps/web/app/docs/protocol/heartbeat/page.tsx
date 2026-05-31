import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Heartbeat'
};

export default function HeartbeatPage() {
  return (
    <DocsMarkdownPage
      title="Heartbeat"
      lead="Heartbeat is the lightweight liveness signal for an attached session. It updates session telemetry without creating a ticket event."
    >
      {`
## What heartbeat carries

Heartbeat can include:

- an optional transient phase
- an optional percent-complete estimate
- an optional short note such as "running tests"

## Why it exists

Use heartbeat during long stretches of mechanical work when you want Overlord to know the agent is still alive, but you do not have a meaningful narrative update for the activity feed.

## Example

\`\`\`bash
ovld protocol heartbeat \\
  --session-key "$SESSION_KEY" --ticket-id "$TICKET_ID" \\
  --phase execute --percent 40 --note "Running the integration suite"
\`\`\`

## Related pages

- [Attach](/docs/protocol/attach)
- [Update](/docs/protocol/update)
- [Ask](/docs/protocol/ask)
      `}
    </DocsMarkdownPage>
  );
}
