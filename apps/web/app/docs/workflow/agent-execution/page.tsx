import type { Metadata } from 'next';

import { DocsMarkdownContent } from '../../_components/docs-markdown-content';
import { DocsMarkdownPage } from '../../_components/docs-markdown-page';
import { RunnerArchitectureDiagram } from '../../_components/runner-architecture-diagram';
import { RunnerSequenceDiagram } from '../../_components/runner-sequence-diagram';

export const metadata: Metadata = {
  title: 'Agent Execution & Runner',
  description:
    'How ovld runner claims queued execution requests, why it may launch work automatically, and how to clear an execution request by objective id.'
};

const INTRO = `
In Overlord, the Next.js backend decides **what** should run by writing a durable row to the \`execution_requests\` queue. A machine capable of running agents runs the **Terminal Runner (\`ovld runner\`)** to claim these rows and start the agent locally using the **\`ovld launch\`** command.

This architecture decouples coordination from execution. Spawning a terminal, managing environment variables, PATH settings, shell configurations, and credentials are all handled locally by the runner process. This means the Electron desktop app is completely optional—you can run a headless terminal runner on your workstation, in a cloud environment, or on a remote server.

---

## Who opens the terminal?

Three layers are involved. Only the bottom layer touches the host shell.

| Layer | Component | Opens a terminal? | Role |
| --- | --- | --- | --- |
| Coordination | Overlord backend (Next.js / Supabase) | **No** | Decides *which* objective should run next, promotes draft → \`submitted\`, inserts a row in \`execution_requests\`, emits \`execution_requested\` for the UI. |
| Dispatch | \`ovld runner\` on a capable machine | **Indirectly** | Polls (or listens via Realtime), claims a compatible queued row, then **spawns** \`ovld launch\` as a child process. |
| Launch | \`ovld launch <agent>\` | **Yes** | Starts the assigned agent (Claude Code, Cursor, Codex, etc.) in a new terminal session or remote tmux/SSH context using local PATH, credentials, and working directory. |

The backend never SSHs into your machine and never spawns a local process. If no runner is running, the request stays \`queued\` until something on a capable host runs \`ovld runner start\` or \`ovld runner once\`, or a human copies the fallback \`ovld launch\` command from the UI.

---

## How an objective reaches the runner

1. **Objective exists on the ticket** — usually as \`draft\` (next step) or already \`launching\` (a queued launch request; the legacy \`submitted\` state is treated identically).
2. **Trigger enqueues work** — auto-advance after \`deliver\`, or a human **Run** / \`ovld protocol request-execution\`. Both call the same \`execution_requests\` queue. Creating a request moves the objective \`draft -> launching\`; a repeat Run for an objective that already has an active request **re-queues that request** instead of creating a duplicate.
3. **Row is \`queued\`** — stores resolved agent, model, thinking, flags, target execution target/resource, and launch mode. The UI can show “waiting for runner.”
4. **Runner claims** — \`ovld runner\` calls \`POST /api/protocol/claim-execution\` with the device fingerprint from \`~/.ovld/device.json\`. The row moves to \`claimed\` with a lease. The claim payload includes the working directory resolved from [project resource directories](/docs/workflow/execution-targets) on that target.
5. **Runner launches** — the runner builds \`ovld launch …\` arguments from the claim payload and spawns that process (\`stdio: inherit\` so output appears in the runner’s terminal).
6. **Runner reports spawn** — on child \`spawn\`, it calls \`complete-execution-launch\`; the row becomes \`launching\` (the launch process started, but no agent has attached yet).
7. **Next agent attaches** — the new agent process calls \`ovld protocol attach\`, loads ticket context, executes the launchable objective, and **only then** is the matching request marked \`launched\` (with \`launched_session_id\`). Attach is the source of truth for a successful launch; a \`claimed\`/\`launching\` row whose agent never attaches before its lease expires is treated as a **stalled launch** — it is marked \`failed\`, cleared from the queue, and the user is notified to relaunch manually (it is **not** auto-relaunched).

Auto-advance and manual Run differ only at step 2 (scheduler vs. Run button / protocol). Steps 3–7 are identical.

---

## Architecture Flow

The following diagram illustrates how triggers (like clicking "Run" or an agent delivering an objective) create execution requests, and how the Terminal Runner claims and spawns the agent locally.
`;

const AFTER_ARCHITECTURE = `
---

## End-to-End Sequence

The step-by-step lifecycle of an execution request, from the current agent delivering its work to the next agent attaching, is detailed below:
`;

const REST = `
---

## Execution Request Queue

All execution triggers (whether automated or manual) write to the unified \`execution_requests\` table. Each row acts as a durable lease:

- **Idempotency**: A partial unique index on \`execution_requests(objective_id) WHERE status IN ('queued','claimed','launching')\` guarantees at most one **active** request per objective — this is what suppresses duplicate runs. The \`manual_run:<objective_id>:<client_request_id>\` idempotency key stays non-deterministic on purpose so a terminal-state (\`failed\`/\`launched\`) row never blocks a legitimate relaunch; auto-advances use \`auto_advance:<objective_id>\`.
- **Leasing**: When a runner claims a request, the row transitions to \`claimed\` with a \`lease_expires_at\` timestamp. If the agent never attaches before the lease expires (the runner crashed, the launch errored, the terminal was closed, …), the backend does **not** silently re-claim it — that produced an annoying relaunch loop every lease window. Instead it marks the request \`failed\`, clears it from the queue, and emits an alert notification so the user can relaunch manually (with a Retry action).

### Request Status States
| Status | Meaning |
| --- | --- |
| \`queued\` | Waiting for a runner that matches the target device, resource, or kind. |
| \`claimed\` | Leased by a device fingerprint; runner is preparing to launch. |
| \`launching\` | Runner spawned the launch process, but no agent has attached yet. A stale \`launching\`/\`claimed\` row (lease expired with no attach) is marked \`failed\` and the user is notified — it is not auto-relaunched. |
| \`launched\` | An agent attached and created its session; \`launched_session_id\` is recorded. Set by attach, not by the runner. |
| \`failed\` | Spawning error, or a stalled launch whose lease expired before any agent attached. Reason recorded in the \`last_error\` column. |

---

## Execution targets and working directories

Before a runner can launch an agent in the right checkout, Overlord needs an **execution target** (the machine) and **project resource directories** (paths on that target). The runner matches queued rows by fingerprint; \`claim-execution\` picks the explicit \`target_resource_id\` or the primary directory for \`(project, execution_target)\`.

### Working directory resolution

For each candidate row the runner resolves the working directory in priority order:

1. **Explicit \`workingDirectory\` in \`launch_params\`** — used as-is (SSH command flows).
2. **\`target_resource_id\` set** — looks up the path from \`project_resource_directories\` and verifies it lives on the claiming target.
3. **Fallback: \`(project, target)\` primary** — selects the \`is_primary = true\` row for \`(project_id, execution_target_id)\`. Primary is **target-scoped** — no user filter is applied; all users on a project share the same primary checkout per target.
4. **No primary found** — a \`ticket_event\` backstop is recorded and the request is skipped (fail-closed). Overlord also validates at request time that a primary exists before inserting a queue row.

See [Execution Targets & Resources](/docs/workflow/execution-targets) for the data model, SSH placeholder flow, primary semantics, target ownership, and protocol commands (\`get-device\`, \`list-project-resources\`, \`add-project-resource\`).

---

## The Terminal Runner (\`ovld runner\`)

The Terminal Runner is a lightweight, long-running CLI process that manages local execution. It handles:
1. **Device Identity**: Generates a unique UUID fingerprint stored in \`~/.ovld/device.json\` to identify the machine (linked to a canonical execution target).
2. **Project Directories**: Resolves working directories from registered project resources on the current execution target fingerprint.
3. **Queue Polling**: Regularly polls the backend (or subscribes via Supabase Realtime) for compatible queued requests.
4. **Agent Spawning**: Spawns agent sessions locally by shelling into \`ovld launch\`.

The runner is **org-agnostic**: one runner process on a target claims queued work for every organization the authenticated user belongs to that has that target registered. You do not need a separate runner per organization — the server computes the intersection of the user's member orgs and the orgs sharing the target.

### CLI Commands

\`\`\`bash
# Start the runner, polling continuously for queued requests (default 3000ms)
ovld runner start

# Claim and execute a single queued request, then exit
ovld runner once

# Inspect the local runner device identity plus visible active queue rows
ovld runner status

# Clear one active queue row by objective id
ovld runner clear <objective-uuid>

# Clear every active queue row visible to the caller
ovld runner clear-all
\`\`\`

### Command Options

- \`--device-fingerprint <fingerprint>\`: Manually override the runner's device identity (or set the \`OVERLORD_DEVICE_FINGERPRINT\` environment variable).
- \`--poll-interval-ms <ms>\`: Adjust the polling interval when running in \`start\` mode (default is \`3000\`, minimum \`1000\`).
- \`--project-id <uuid>\`: Restrict the runner to only claim requests belonging to a specific project.

---

## Troubleshooting: "Why is \`ovld runner\` randomly executing?"

Usually it is not random. A previous **Run** action or an **auto-advance** objective created an active row in \`execution_requests\`, and a local \`ovld runner\` later claimed it.

Check the visible queue first:

\`\`\`bash
ovld runner status
\`\`\`

Clear one objective if you know the objective id:

\`\`\`bash
ovld runner clear 8974e557-bec4-4984-b12c-be46bd63207c
\`\`\`

Or use the protocol command directly:

\`\`\`bash
ovld protocol clear-execution-requests \\
  --objective-id 8974e557-bec4-4984-b12c-be46bd63207c
\`\`\`

Use \`clear-all\` only when you want to drop every active queue row visible to the current auth scope.

---

## Manual Run vs. Auto-Advance

Both execution models utilize the same queue mechanism:

| Trigger Mode | Backend Behavior | Local Behavior |
| --- | --- | --- |
| **Auto-Advance** | Current agent delivers a successful pass. If the next objective has \`auto_advance = true\`, the backend automatically enqueues an execution request. | A local running \`ovld runner\` automatically claims and spawns the next objective seamlessly. |
| **Manual Run** | A human clicks **Run** in the web UI, mobile app, or uses \`ovld protocol request-execution\`. | If a runner is active, the request is claimed and launched. If no runner is active, the UI guides the user with a copyable \`ovld launch\` fallback. |

---

## Related Pages

- [Execution Targets & Resources](/docs/workflow/execution-targets)
- [Objectives](/docs/workflow/objectives)
- [Tickets](/docs/workflow/tickets)
- [CLI Reference](/docs/surfaces/cli)
- [Protocol Reference](/docs/protocol)
- [File changes & checkpoints](/docs/workflow/file-changes)
`;

export default function AgentExecutionPage() {
  return (
    <DocsMarkdownPage
      title="Agent Execution & Runner"
      lead="Overlord coordinates ticket progress, but agent processes run in the host-local environment best suited to the task."
    >
      <DocsMarkdownContent className="prose-headings:scroll-mt-24">{INTRO}</DocsMarkdownContent>
      <RunnerArchitectureDiagram />
      <DocsMarkdownContent className="prose-headings:scroll-mt-24">
        {AFTER_ARCHITECTURE}
      </DocsMarkdownContent>
      <RunnerSequenceDiagram />
      <DocsMarkdownContent className="prose-headings:scroll-mt-24">{REST}</DocsMarkdownContent>
    </DocsMarkdownPage>
  );
}
