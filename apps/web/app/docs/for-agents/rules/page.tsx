import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Rules for Agents'
};

export default function RulesPage() {
  return (
    <DocsMarkdownPage
      title="Rules for Agents"
      lead="Non-negotiable behaviors when working through Overlord. These are the behaviors humans expect and that tooling enforces."
    >
      {`
## Always

- **Attach first, deliver last.** No protocol activity happens outside an attached session.
- **Use \`ovld protocol\` commands.** Don't invent subcommands or hit the API directly;
  run \`ovld protocol help\` if unsure.
- **Treat \`promptContext\` as authoritative** for the objective, constraints, and delivery
  target.
- **Publish user follow-ups.** If the human sends a follow-up message after the initial
  ticket, post it with \`update --event-type user_follow_up\` before acting on it.
- **Cover every meaningful change in \`changeRationales\`** when delivering. Skip
  formatting-only noise.
- **Stop after \`ask\`.** Do not keep working on the blocked path while waiting for a human.
- **Stop after \`deliver\`.** Delivery concludes the session unless the user follows up or the
  ticket is reopened.

## Never

- **Never commit or push** changes unless the user explicitly asks you to.
- **Never skip hooks** (\`--no-verify\`, \`--no-gpg-sign\`, etc.) unless the user explicitly
  asks for it.
- **Never run destructive git commands** (\`reset --hard\`, \`push --force\`, \`branch -D\`,
  \`clean -f\`) without explicit permission.
- **Never send \`file_changes\` as an artifact.** Use \`changeRationales\` instead.
- **Never invent protocol subcommands or flags.** Use the real ones from
  \`ovld protocol help\`.

## Asking for permission

If your runtime needs to use a tool that requires human approval, surface the request
through the permission hook rather than silently bypassing:

\`\`\`bash
ovld protocol permission-request --ticket-id "$TICKET_ID" --payload-file -
\`\`\`

Installed permission hooks normally invoke this for you.

## When to ask vs. decide

- Ask when a decision would change the shape of the delivery (API surface, data model,
  migration direction) and the ticket doesn't specify.
- Decide when the ticket or prior context already answers it. Record your reasoning in the
  next update so the human can review.

## Writing good updates

- Phase \`execute\` while actively working.
- Keep summaries action + reason: *"Added retry on 5xx responses because upstream is flaky."*
- Attach change rationales alongside long-running work so reviewers see progress, not just a
  final blob.

## Writing good deliveries

- The \`summary\` is what the reviewer reads first. Make it a narrative: what you did, what
  you decided, what's next.
- Include a \`next_steps\` artifact when there's obvious follow-up work.
- Prefer \`--payload-file -\` and stream JSON on stdin for larger payloads so no scratch file
  is left behind.

## Related pages

- [Ticket lifecycle](/docs/for-agents/lifecycle)
- [CLI reference](/docs/for-agents/cli-reference)
- [Context &amp; artifacts](/docs/for-agents/context-and-artifacts)
      `}
    </DocsMarkdownPage>
  );
}
