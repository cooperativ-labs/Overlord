import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'Agent CLI Reference',
  description:
    'Every ovld protocol subcommand an agent runtime needs, with required and optional flags. Run ovld protocol help locally for the live, authoritative list.',
  alternates: {
    canonical: 'https://www.ovld.ai/docs/for-agents/cli-reference'
  }
};

export default function CliReferencePage() {
  return (
    <DocsMarkdownPage
      title="ovld protocol — CLI reference"
      lead="Every ovld protocol subcommand an agent runtime needs, with required and optional flags. Run ovld protocol help locally for the live, authoritative list."
    >
      {`
## Environment fallbacks

All subcommands honor these environment variables so you don't have to pass flags every time:

\`\`\`bash
SESSION_KEY=<key>        # falls back to --session-key
TICKET_ID=<ticket_id>           # falls back to --ticket-id
OVERLORD_URL=<url>       # API host
OVERLORD_ORGANIZATION_ID=<id>  # legacy org scope for UUID ticket ids and non-ticket commands
OVERLORD_TIMEOUT=<ms>    # falls back to --timeout
AGENT_IDENTIFIER=<name>  # falls back to --agent (default: claude-code)
\`\`\`

## Common flags

\`\`\`text
--timeout <ms>              Request timeout in milliseconds (default: 30000)
--ticket-id <ticket_id>            Ticket this call operates on
--session-key <key>         Session key returned by attach/connect/prompt
--agent <identifier>        Agent identifier (default: AGENT_IDENTIFIER or claude-code)
--model <identifier>        Model identifier to use when executing objectives
--method <connectionMethod> Connection method (default: cli)
\`\`\`

Ticket ids like \`1:899\` carry the organization id. Ticket-scoped commands use that first, then \`--organization-id\` for UUID compatibility, then stored auth.

---

## auth-status

Check whether the local runtime has usable Overlord credentials.

\`\`\`bash
ovld protocol auth-status
\`\`\`

Returns JSON with \`ok=true|false\` plus \`authStatus\` fields describing token and host sources.

## discover-project

Resolve the Overlord project that corresponds to a working directory. Uses your configured
"Local working directory" on each project for matching.

\`\`\`bash
ovld protocol discover-project
ovld protocol discover-project --working-directory /path/to/repo
\`\`\`

Prints \`PROJECT_ID=<id>\` on stderr. Returns 404 with a hint when no match is found.

---

## attach

Create the working session on an existing ticket. Normally the first call you make.

\`\`\`bash
ovld protocol attach --ticket-id <ticket_id>
\`\`\`

Optional:

\`\`\`text
--agent <identifier>
--model <identifier>
--method <connectionMethod>
--external-session-id <id|null>   # store native agent thread id, or clear with "null"
--metadata-json <json>            # extra session metadata
--skip-checkpoint                 # bypass automatic objective-start git checkpoint creation
\`\`\`

Returns full JSON including \`session.sessionKey\`, \`ticket\`, \`history\`, \`artifacts\`,
\`sharedState\`, and \`promptContext\`. In a git workspace, \`attach\` creates a
local git checkpoint for each executing objective before work begins, stored
under \`refs/overlord/checkpoints/<objectiveId>\`.

## connect

Lightweight session when you only need a session key, not the full ticket payload.

\`\`\`bash
ovld protocol connect --ticket-id <ticket_id>
\`\`\`

Optional flags match \`attach\`. Prints \`SESSION_KEY\` on stderr when available.

## load-context

Read ticket details without creating a session.

\`\`\`bash
ovld protocol load-context --ticket-id <ticket_id>
\`\`\`

## revert

Restore the local git working tree to an objective checkpoint. The CLI fetches
the checkpoint row from Overlord, saves a safety ref under
\`refs/overlord/safety/\`, then restores the tree.

\`\`\`bash
ovld protocol revert --objective-id <objective-uuid>
ovld protocol revert --objective-id <objective-uuid> --working-directory /path/to/repo
\`\`\`

## search-tickets

Find tickets by free-text query, status, project, creator, or update window.
Omit \`--query\` for list mode (most recently updated first).

\`\`\`bash
ovld protocol search-tickets --query "auth refactor" --status next-up,execute --limit 10
ovld protocol search-tickets --status next-up --project-id <uuid>
\`\`\`

Optional:

\`\`\`text
--query <text>             Free-text search across the ticket search vector + title fallback
--status <csv>             Comma-separated statuses, e.g. "draft,next-up,execute"
--include-completed <bool> Include completed tickets (default: false)
--limit <n>                Max results 1..50 (default: 8)
--project-id <uuid>
--created-by <uuid>
--updated-after <iso>      Updated_at >= ISO timestamp
--updated-before <iso>     Updated_at <= ISO timestamp
\`\`\`

Returns JSON \`{ tickets, count }\`.

---

## create

Create a draft ticket without attaching. If session flags are provided it creates a follow-up
draft linked to the current ticket; otherwise it creates a standalone draft, resolving the
project from the current working directory.

\`\`\`bash
ovld protocol create --agent claude-code \\
  --objective "Capture follow-up work from this repo"

ovld protocol create --agent claude-code \\
  --session-key <key> --ticket-id <ticket_id> \\
  --objective "Write migration notes"
\`\`\`

Optional:

\`\`\`text
--working-directory <path>   Override cwd for project resolution
--project-id <id>            Explicit project for standalone drafts
--personal                   Private standalone draft, no project
--title <text>
--priority <low|medium|high|urgent>
--acceptance-criteria <text>
--available-tools <text>
--execution-target <agent|human>
--delegate <model>
\`\`\`

## prompt

Create a ticket and attach to it immediately. Use when you want execution to start
right away.

\`\`\`bash
ovld protocol prompt --agent claude-code \\
  --objective "Implement user auth" --priority high
\`\`\`

Shares most flags with \`create\`, plus \`--parent-session-key\`, \`--parent-ticket-id\`, and
\`--metadata-json\`. Returns ticket/session JSON and prints \`SESSION_KEY\` / \`TICKET_ID\` on stderr.

---

## update

Post progress events during execution.

\`\`\`bash
ovld protocol update \\
  --session-key <key> --ticket-id <ticket_id> \\
  --summary "Wired up the new retry policy." \\
  --phase execute
\`\`\`

Optional:

\`\`\`text
--summary-file <path>               # read summary from a file instead of --summary
--phase <draft|execute|review|deliver|complete|blocked|cancelled>
--event-type <update|user_follow_up|alert>
--payload-json <json>               # additional structured payload
--external-url <url|null>           # store or clear a deep link to the live session
--external-session-id <id|null>
--change-rationales-json <json>
--change-rationales-file <path>
\`\`\`

## record-change-rationales

Persist structured file-change rationale records without also posting a progress update.

\`\`\`bash
ovld protocol record-change-rationales \\
  --session-key <key> --ticket-id <ticket_id> \\
  --change-rationales-json '[ ... ]'
\`\`\`

## ask

Raise a blocking question. Stop working until a human responds.

\`\`\`bash
ovld protocol ask \\
  --session-key <key> --ticket-id <ticket_id> \\
  --question "Specific question for the reviewer."
\`\`\`

Optional: \`--question-file <path>\`, \`--phase <status>\`, \`--payload-json <json>\`.

## permission-request

Notify Overlord that the local runtime is requesting tool permission. Primarily used by
installed permission hooks, not called directly by agent logic.

\`\`\`bash
ovld protocol permission-request --ticket-id <ticket_id> --payload-file -
\`\`\`

## hook-event

Record a lifecycle hook event without requiring a session key. This is primarily used by
installed \`UserPromptSubmit\` hooks (Claude Code, Codex) and Cursor IDE \`beforeSubmitPrompt\` hooks
to capture follow-up user messages automatically.

\`\`\`bash
ovld protocol hook-event --hook-type UserPromptSubmit --ticket-id <ticket_id> \\
  --prompt "Verbatim follow-up message" --turn-index 1
\`\`\`

Optional: \`--prompt <text>\`, \`--turn-index <n>\`.

---

## read-context

Read persistent shared context written by earlier sessions.

\`\`\`bash
ovld protocol read-context --session-key <key> --ticket-id <ticket_id>
ovld protocol read-context --session-key <key> --ticket-id <ticket_id> --query arch --limit 5
\`\`\`

## write-context

Save shared facts for future sessions. The value is parsed as JSON first and stored as a
string if that fails.

\`\`\`bash
ovld protocol write-context --session-key <key> --ticket-id <ticket_id> \\
  --key "arch" --value '"monorepo"' --tags repo,agent
\`\`\`

---

## deliver

Conclude the session with the final summary, artifacts, and change rationales.

\`\`\`bash
ovld protocol deliver \\
  --session-key <key> --ticket-id <ticket_id> \\
  --summary "Done — narrative of what changed and next steps." \\
  --change-rationales-json '[ ... ]'
\`\`\`

Optional:

\`\`\`text
--summary-file <path>
--artifacts-json <json>
--artifacts-file <path|->
--change-rationales-json <json>
--change-rationales-file <path|->
--payload-json <json>              # full { summary, artifacts, changeRationales } JSON inline
--payload-file <path|->            # full { summary, artifacts, changeRationales } JSON
--skip-file-change-check           # bypass local git vs changeRationales validation
\`\`\`

Local git checkpoints are created on \`attach\` (one per executing objective at
\`refs/overlord/checkpoints/<objectiveId>\`), not on \`deliver\`. Pass
\`--skip-checkpoint\` to \`attach\` to opt out of that behavior. \`deliver\` itself
does not create a checkpoint; restore an objective checkpoint with
\`ovld protocol revert --objective-id <id>\`.

In a git workspace, \`deliver\` validates that changed files are represented by
\`changeRationales\` unless the check is skipped.

## Objective attachments

Upload and download files attached to a ticket objective. The \`attach\` and
\`load-context\` responses already include \`attachments\` and \`objectives\`
arrays — use those for \`<attachment-id>\` and \`<objective-id>\` values.

\`\`\`bash
# Discover attachments mid-session (also surfaced in attach response)
ovld protocol attachment-list \\
  --session-key <key> --ticket-id <ticket_id>

# Upload a local file in one call
ovld protocol attachment-upload-file \\
  --session-key <key> --ticket-id <ticket_id> --objective-id <objective-id> \\
  --file ./spec.pdf --content-type application/pdf

# Or do it in two steps with a signed URL
ovld protocol attachment-prepare-upload \\
  --session-key <key> --ticket-id <ticket_id> --objective-id <objective-id> \\
  --file-name spec.pdf --content-type application/pdf
ovld protocol attachment-finalize-upload \\
  --session-key <key> --ticket-id <ticket_id> --objective-id <objective-id> \\
  --storage-path <path> --label "Spec"

# Get a signed download URL
ovld protocol attachment-download-url \\
  --session-key <key> --ticket-id <ticket_id> \\
  --attachment-id <attachment-id>
\`\`\`

---

## Related pages

- [Ticket lifecycle](/docs/for-agents/lifecycle)
- [Context &amp; artifacts](/docs/for-agents/context-and-artifacts)
- [Rules for agents](/docs/for-agents/rules)
      `}
    </DocsMarkdownPage>
  );
}
