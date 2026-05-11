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

A **checkpoint** is a snapshot of the working tree after meaningful edits—think “save game” for the repo state the agent is using. Checkpoints give Overlord a stable anchor: what tree was live when rationales were recorded, and what reviewers should diff against.

Agents are expected to checkpoint at natural boundaries (for example after a batch of edits and before delivery), not after every keystroke.

## How Jujutsu (jj) fits in

Overlord uses **[Jujutsu](https://docs.jj-vcs.dev/latest/)** (\`jj\`), a modern version-control tool, as an **internal snapshot engine** when it is available on the machine running the session.

In simple terms:

- **Git** stays the format teams already use for branches and collaboration.
- **jj** helps Overlord keep **isolated, per-session workspaces** and take **lightweight snapshots** so file history and checkpoints do not depend on fragile ad hoc copies.

For ordinary Git repos, Overlord can still read status and diffs directly from the linked working directory.

For plain folders, version control is **off by default**. In the Desktop app, project settings include **Install version control in this folder**. Enabling it initializes \`jj\` in the original local folder and stores the opt-in on your user/project settings. Current Changes then reads that same folder for status and diffs.

When \`jj\` is installed and healthy, delivery creates a local checkpoint before the API request and stores the JJ ids with the file-change records. Older managed sessions may still use a shadow repository and jj workspaces under Overlord’s application data directory, but in-folder JJ is the normal path for plain folders.

If \`jj\` is missing or fails its health check, Overlord **falls back** to a Git worktree backend. Change records and delivery still work; only the richer jj-specific provenance fields may be empty for those sessions.

## Why this matters for review

Checkpoints plus file-change records mean the product can:

- show **what changed** with human-readable rationales
- link changes **back to the ticket** (and objectives) that produced them
- open **diffs** from the review UI with the right context

You get version control discipline without asking every user to operate jj by hand.

## For agents: rationales and snapshots

Agents submit structured **change rationales** on update, deliver, or dedicated record calls, and may attach optional **snapshot** metadata so rows line up with the checkpoint that was taken. See [Context & artifacts](/docs/for-agents/context-and-artifacts) for the exact payload shape and CLI examples.

## Related pages

- [Review & delivery](/docs/workflow/review)
- [Agent execution](/docs/workflow/agent-execution)
- [Context & artifacts](/docs/for-agents/context-and-artifacts)
- [Workflow overview](/docs/workflow)
      `}
    </DocsMarkdownPage>
  );
}
