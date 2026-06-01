import type { Metadata } from 'next';

import { MarkdownContent } from '@/components/features/MarkdownContent';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';
import { ExecutionTargetsArchitectureDiagram } from '../../_components/execution-targets-architecture-diagram';
import { ExecutionTargetsPlaceholderDiagram } from '../../_components/execution-targets-placeholder-diagram';

export const metadata: Metadata = {
  title: 'Execution Targets & Resources'
};

const INTRO = `
Overlord needs to know **where** agent work runs: your laptop, a remote Linux box over SSH, a devbox, or any future hosted runner. That machine (or environment) is an **execution target**. The **checkout path** for a project on that target is a **project resource directory**.

Together they replace the older pattern of storing SSH host, remote path, and local path on \`project_user\`. Paths and connection topology now live in dedicated tables so the device you SSH into can maintain its own resources while the backend resolves a consistent working directory for \`ovld launch\` and \`ovld runner\`.

---

## Core concepts

| Concept | What it is | Example |
| --- | --- | --- |
| **Execution target** | Canonical row for a machine or SSH endpoint agents execute on | Your Mac (\`device_fingerprint\` from \`~/.ovld/device.json\`), or \`ssh:build.example.com:22\` before first registration |
| **Organization label** | Human-friendly name unique within an org | \`builder-mac\`, \`linux-ci\` |
| **Project resource directory** | A checkout path on a target for a given project | \`/home/dev/overlord\` marked \`is_primary\` for project X on target Y |
| **Primary resource** | The default directory when no explicit resource is chosen | One primary per **(project, execution target)** — shared by all users on that project/target pair |

An execution target is **not** owned by a single user or organization. Instead:

- \`execution_targets\` holds canonical identity (fingerprint or placeholder key, host, port, transport).
- \`organization_execution_targets\` adds org-scoped labels.
- \`user_execution_targets\` records which users may use the target.
- \`execution_target_ssh_credentials\` stores per-user SSH metadata (username, auth method, private key **path** — never private key material).
- \`project_execution_targets\` links targets to projects.
- \`project_resource_directories\` is the **path authority**: every resource points at exactly one \`execution_target_id\`.

---

## Local vs SSH targets

**Local targets** register when \`ovld\` runs on the machine. \`ovld protocol get-device\` (or the runner on startup) upserts \`execution_targets\` with a real \`device_fingerprint\`, \`transport=local\`, and the hostname from the OS.

**SSH targets** can be configured before the remote host has ever run Overlord:

1. The web app saves host, port, username, and key path.
2. Overlord creates a **placeholder** target with \`placeholder_key=ssh:{host}:{port}\`.
3. Resource and association rows are wired immediately so you can queue work against the remote path.
4. When \`ovld\` eventually runs on the remote machine and calls \`get-device\`, the placeholder reconciles to the real fingerprint without changing \`execution_target_id\`.

The same physical server can appear in multiple organizations with different labels. Host and port are connection coordinates, not global identity — two VMs on one host are two targets if agents execute inside each VM.

---

## How targets connect to the runner

When you click **Run** or auto-advance enqueues an objective, \`execution_requests\` stores:

- \`target_execution_target_id\` — which machine should run the agent
- \`target_resource_id\` — optional explicit resource; otherwise the primary directory for that project/target pair

\`ovld runner\` claims rows whose target matches its fingerprint (from \`~/.ovld/device.json\`). It is **org-agnostic**: a single runner process serves queued work across every organization the user belongs to that also shares the claiming target. \`claim-execution\` computes the intersection of (user's member orgs) and (orgs that include the target) to scope the queue, so a developer's laptop can pick up requests from all their organizations without separate runner instances.

\`claim-execution\` resolves the working directory from the target resource, or falls back to the primary \`project_resource_directories\` row for \`(project_id, execution_target_id)\`. If no primary exists, the request is skipped and a backstop event is recorded rather than launching in an unknown directory.

See [Agent Execution & Runner](/docs/workflow/agent-execution) for the full queue lifecycle, leasing, and launch sequence.

---

## Data model

The diagram below shows how canonical targets relate to org/user/project layers and resource directories.
`;

const AFTER_ARCHITECTURE = `
---

## Primary resource semantics

**Primary** means “use this path when the execution request does not specify a resource.” Constraints:

- At most one \`is_primary=true\` row per \`(project_id, execution_target_id)\` — enforced by a partial unique index.
- Primary is **project topology**, not per-user: two teammates working on the same project on the same target share the same primary checkout path.
- SSH credentials remain **per user** (stored in \`execution_target_ssh_credentials\`); only the directory path is shared at the project/target level.
- The first directory added for a (project, target) auto-promotes to primary. If you remove the primary, the next oldest directory for that pair is promoted automatically.

When you add a resource from the desktop app or protocol, setting \`is_primary\` clears any other primary on that same project and target.

---

## Target ownership

\`organization_execution_targets\` has a nullable \`owner_user_id\` that controls who may manage directories on the target within that organization.

| Ownership | Who can manage directories |
| --- | --- |
| **Personal** (\`owner_user_id\` set) | Only the owner may add, remove, or change the primary for any project on this target (in this org). |
| **Organization-owned** (\`owner_user_id\` null) | Any user with **ADMIN** or **MANAGER** role on the project may manage directories. VIEWERs are read-only. |

In both cases, all org members may **read** the primary (so they can see the project's working directory). The write authority is enforced in both application code (\`assertCanManagePrimary\`) and RLS (\`can_manage_project_resource_directory()\` SQL helper).

Self-registered targets (local \`ovld runner\` startup) default to personal (owner = the registering user). SSH targets added from the web app can be marked organization-owned at creation time. Ownership can be transferred later by an org admin or the current owner.

---

## Placeholder reconciliation

Use placeholders when you know the SSH endpoint and remote checkout path before the remote machine has registered with Overlord.
`;

const AFTER_PLACEHOLDER = `
---

## Protocol and CLI surface

Agents and the desktop app maintain targets and paths through protocol routes (also available via \`ovld protocol\`):

\`\`\`bash
# Register or refresh the current machine (writes execution_targets + associations)
ovld protocol get-device --device-fingerprint "$OVERLORD_DEVICE_FINGERPRINT"

# List checkout paths for a project on this target
ovld protocol list-project-resources \\
  --project-id <project-uuid> \\
  --device-fingerprint "$OVERLORD_DEVICE_FINGERPRINT"

# Add or update a directory on the current target
ovld protocol add-project-resource \\
  --project-id <project-uuid> \\
  --directory-path /path/to/checkout \\
  --device-fingerprint "$OVERLORD_DEVICE_FINGERPRINT"

ovld protocol update-project-resource --resource-id <uuid> --is-primary true
\`\`\`

\`ovld runner start\` uses the same fingerprint and registered resources when claiming queued requests. Use \`--device-fingerprint\` or \`OVERLORD_DEVICE_FINGERPRINT\` when matching a specific target.

For ticket routing (agent vs human work), \`--for-human\` on \`ovld protocol create\` is a separate concept — see the [CLI reference](/docs/for-agents/cli-reference).

---

## Mental model

\`\`\`
Project
  └── execution target (laptop | SSH server | …)
        └── resource directories (/path/a, /path/b, …)
              └── one primary → default cwd for launch/runner
\`\`\`

**Execution target** answers *which machine*. **Resource directory** answers *which folder on that machine*. **Execution request** ties an objective to both so the runner can spawn \`ovld launch\` in the right place.

---

## Related pages

- [Agent Execution & Runner](/docs/workflow/agent-execution)
- [Tickets](/docs/workflow/tickets)
- [Objectives](/docs/workflow/objectives)
- [CLI Reference](/docs/for-agents/cli-reference)
- [Workflow overview](/docs/workflow)
`;

export default function ExecutionTargetsPage() {
  return (
    <DocsMarkdownPage
      title="Execution Targets & Resources"
      lead="Execution targets are where agents run; project resource directories are the checkout paths on those targets. Together they drive working-directory resolution for the runner and launch commands."
    >
      <MarkdownContent className="prose-headings:scroll-mt-24">{INTRO}</MarkdownContent>
      <ExecutionTargetsArchitectureDiagram />
      <MarkdownContent className="prose-headings:scroll-mt-24">
        {AFTER_ARCHITECTURE}
      </MarkdownContent>
      <ExecutionTargetsPlaceholderDiagram />
      <MarkdownContent className="prose-headings:scroll-mt-24">{AFTER_PLACEHOLDER}</MarkdownContent>
    </DocsMarkdownPage>
  );
}
