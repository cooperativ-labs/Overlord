import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'File changes & checkpoints'
};

export default function FileChangesPage() {
  return (
    <DocsMarkdownPage
      title="File changes & checkpoints"
      lead="Overlord records what changed in the repository and ties those records to tickets. Checkpoints capture a point-in-time snapshot of the workspace so review and provenance stay grounded in real version control."
    >
      {`
## File changes in plain terms

When an agent edits files, humans need more than a wall of terminal output. Overlord stores **file-level change records**: short titles, summaries, why the change was made, and optional diff hints so reviewers can see what moved and connect it back to the ticket.

Those records are the durable story of the patch, separate from chat narrative.

## Checkpoints

A **checkpoint** is a snapshot of the working tree after meaningful edits - think "save game" for the repo state the agent is using. Checkpoints give Overlord a stable anchor: what tree was live when rationales were recorded, and what reviewers should diff against.

Agents are expected to checkpoint at natural boundaries (for example after a batch of edits and before delivery), not after every keystroke.

## How checkpoints are registered

Overlord registers checkpoints from the git state of the working directory it already tracks.

In practice:

- The client captures a snapshot with the current \`gitCommitId\`, \`headSha\`, and optional \`diffStat\`.
- \`update\`, \`deliver\`, and \`record_change_rationales\` send that snapshot to the API.
- The API writes or updates a \`project_checkpoints\` row keyed by \`project_id\` and \`objective_id\`.
- File-change rows then point at that checkpoint so review can show the exact tree that was current when the rationale was recorded.

Delivery can also include explicit checkpoint metadata. When present, Overlord stores the checkpoint kind alongside the git commit and links the rationale rows to the same checkpoint record.

For ordinary Git repos, Overlord can still read status and diffs directly from the linked working directory.

For plain folders, version control is off by default. In the Desktop app, project settings include **Initialize in this folder** after you connect a repository. That stores the opt-in on your user/project settings and uses the chosen working directory for status, diffs, and checkpoint registration.

## Why this matters for review

Checkpoints plus file-change records mean the product can:

- show **what changed** with human-readable rationales
- link changes **back to the ticket** (and objectives) that produced them
- open **diffs** from the review UI with the right context

You get version control discipline without asking every user to manage checkpoints by hand.

## For agents: rationales and snapshots

Agents submit structured **change rationales** on update, deliver, or dedicated record calls, and may attach optional **snapshot** metadata so rows line up with the checkpoint that was registered. See [Context & artifacts](/docs/for-agents/context-and-artifacts) for the exact payload shape and CLI examples.

## Related pages

- [Review & delivery](/docs/workflow/review)
- [Agent execution](/docs/workflow/agent-execution)
- [Context & artifacts](/docs/for-agents/context-and-artifacts)
- [Workflow overview](/docs/workflow)
      `}
    </DocsMarkdownPage>
  );
}
