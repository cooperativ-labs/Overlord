# Execution Targets, Resources, and the Overlord Runner

**This document covers everything an agent or user needs to know about execution targets, resource directories, target ownership, and the `ovld runner` — the three interlocking concepts that control where and how Overlord launches agent work.**

---

## Overview

When Overlord queues a ticket objective for an agent to execute, it needs to know three things:

1. **Where** will the agent run? → **Execution target**
2. **Which directory** on that target contains the project checkout? → **Resource directory**
3. **What actually picks up the work and starts the agent?** → **The runner**

These three concepts form a pipeline: a user queues work in the Overlord UI or via CLI → the execution target receives the request → the runner on that target claims it → the runner resolves the correct resource directory → the agent launches inside that directory.

---

## Execution Targets

An **execution target** represents a machine (physical or virtual) that can run agent processes on behalf of a user. Every target has a stable identity derived from a device fingerprint — a unique string generated when `ovld` first runs on that machine.

### Target types

| Transport | Description |
|-----------|-------------|
| `local`   | The machine running `ovld runner` directly (a developer's laptop, a workstation, a CI host). |
| `ssh`     | A remote server accessed via SSH. Overlord stores the connection parameters (host, port, username, auth method) and the runner tunnels through SSH to launch the agent. |

### Target lifecycle

1. **Auto-registration** — when `ovld runner` polls for work, it registers the local device fingerprint with Overlord automatically. The target record is created or updated on the first `claim-execution` call. No manual registration step is required for local targets.
2. **SSH targets** — SSH targets can be pre-registered as *placeholder* records (identified by `ssh:<host>:<port>`) before the runner has ever connected from that host. When the runner connects for the first time, the placeholder is promoted to a full target by binding its device fingerprint.
3. **Labels** — each target gets a human-readable label per organization (e.g., `macbook-pro`, `prod-server-1`). Labels are generated from the hostname and platform and can be renamed via `ovld protocol update-device`.

### Key database tables

| Table | Purpose |
|-------|---------|
| `execution_targets` | One row per physical machine. Stores `device_fingerprint`, `host`, `port`, `transport`, `platform`, `last_seen_at`. |
| `organization_execution_targets` | Associates a target with an organization. Stores the per-org `label` and `owner_user_id`. |
| `user_execution_targets` | Associates a target with a specific user within any org. Tracks `last_connected_at`, `access_status`, and the user's default SSH username. |
| `project_execution_targets` | Associates a target with a project (controls which targets are available when queuing a run for a project). |
| `execution_target_ssh_credentials` | Per-user SSH credentials for a target: username, auth method (`agent`, `key`, `tailscale`), private key path, host key fingerprint. |

### Target ownership

Every target registered within an organization has an **ownership** classification, stored in `organization_execution_targets.owner_user_id`:

- **Personal target** (`owner_user_id` is set) — only the owner can manage resource directories for any project on this target. The owner can also transfer ownership or make the target org-owned.
- **Org-owned target** (`owner_user_id` is `null`) — any organization member with the `ADMIN` or `MANAGER` role can manage resource directories for any project on this target.

**Default ownership:**

- A self-registered local target (laptop running `ovld`) defaults to **personal**, owned by the user who ran `ovld` first.
- An SSH target registered via `ovld protocol add-project-resource` or `ovld add-cwd` also defaults to personal (owned by the registering user). Pass `ownerUserId: null` explicitly to make it org-owned at registration time.

**Changing ownership:**

Ownership changes are made through the Overlord UI (Settings → Execution Targets) or via server actions. Two operations are available:

- **Make org-owned** — the current owner (or any org admin) can clear the owner, making the target shared.
- **Claim** — an org admin can take ownership of an org-owned target, making it personal again.

**Authorization rule:**

```
personal target → only the owner may manage resource directories
org-owned target → any org ADMIN or MANAGER may manage resource directories
```

This applies per-organization. A single physical machine can be personal in one org and org-owned in another (because `owner_user_id` lives on the `organization_execution_targets` join row, not on the `execution_targets` row itself).

---

## Resource Directories

A **resource directory** (`project_resource_directories`) is a local filesystem path on an execution target that contains a project's checkout. It tells the runner exactly where to `cd` before launching the agent.

### Primary directory

Each (project, execution target) pair has at most one **primary** resource directory (`is_primary = true`). The primary is:

- **Target-scoped, not user-scoped** — on a shared target there is one primary per (project, target), shared across all users.
- **Auto-promoted** — the first directory registered for a (project, target) pair automatically becomes primary.
- **Required for runner launches** — unless an explicit `workingDirectory` or `sshCommand` is provided when queuing the run, the runner will refuse to claim a queued request if no primary directory exists for the (project, target). Overlord surfaces this as a `system` ticket event: *"No primary resource directory is set for this project on this execution target."*

### Registering resource directories

**Interactive (recommended for local machines):**

```bash
# From within the project directory:
ovld add-cwd

# Or specify a path explicitly:
ovld add-cwd --directory /path/to/project

# Register without making it primary (rarely needed):
ovld add-cwd --primary=false
```

`ovld add-cwd` registers the directory, marks it primary for the device, and writes a `project.json` configuration file to `.overlord/project.json` in the directory.

**Via the protocol API (for agent and automation use):**

```bash
# Add a resource directory
ovld protocol add-project-resource \
  --project-id <uuid> \
  --directory /path/to/project \
  --label "my-checkout"

# List all resource directories for a project
ovld protocol list-project-resources --project-id <uuid>

# Update a directory's path, label, or primary status
ovld protocol update-project-resource \
  --resource-id <uuid> \
  --primary true
```

### Authorization for managing resource directories

Who can add, update, or delete a resource directory for (project, target) is governed by target ownership:

- **Personal target** → only the target owner.
- **Org-owned target** → any org ADMIN or MANAGER.

Project ADMIN role is also required to attach a target to a project in the first place (`project_execution_targets`), but managing individual directories on an already-attached target follows the ownership rule above.

---

## The Overlord Runner

The **runner** is the process that continuously polls Overlord for queued execution requests and launches the agent when work is available. It runs on your machine (or a remote server) via the `ovld runner` command.

### How it works

1. **Poll** — the runner calls `ovld protocol claim-execution` on a configurable interval (default 3 seconds). The claim call sends the device fingerprint so Overlord can identify which target is checking in.
2. **Claim** — Overlord atomically assigns (claims) the oldest queued execution request that this target is eligible to handle. A claim is protected with a short-lived **lease** — if the agent never attaches before the lease expires, the request is marked failed and the user is notified to retry.
3. **Resolve working directory** — Overlord resolves the working directory in this order:
   - An explicit `workingDirectory` override provided when the run was queued.
   - The `targetResourceId` if a specific resource directory was selected.
   - The primary resource directory for (project, claiming target).
4. **Launch** — the runner calls `ovld launch <agent>` with the resolved ticket ID, working directory, agent identifier, model, and any per-target agent flags. The agent process starts, attaches to the ticket session, and begins executing the objective.
5. **Complete or fail** — after the agent launches, the runner calls `ovld protocol complete-execution-launch` (success) or `ovld protocol fail-execution-launch` (failure). These move the execution request out of the `claimed`/`launching` state.

### Target eligibility

A runner can only claim a request when **all** of the following are true:

- The claiming user is a member of the request's organization.
- The claiming target is associated with that organization (`organization_execution_targets`).
- The request is either `target_kind: any` or `target_kind: local` (or `ssh` if the request has an SSH command).
- If the request pinned a specific target (`target_execution_target_id`), the claiming target's ID matches.
- A primary resource directory exists for (project, claiming target), unless an explicit working directory or SSH command was provided.

### Runner commands

```bash
# Run once: claim and launch a single queued request (if any), then exit
ovld runner once

# Start the continuous runner daemon (polls every 3 seconds by default)
ovld runner start

# Show the current queue and runner status
ovld runner status

# Clear the queued request for a specific objective
ovld runner clear <objective_id>

# Clear all queued requests for this user
ovld runner clear-all
```

**Options available on all runner commands:**

| Flag | Description |
|------|-------------|
| `--device-fingerprint <fp>` | Override the runner's device identity (advanced; normally auto-detected). |
| `--poll-interval-ms <ms>` | How often to check for new requests in `start` mode (default: 3000). |
| `--project-id <uuid>` | Only claim requests for one specific project. |
| `--organization-id <id>` | Only poll one organization (also via `OVERLORD_ORGANIZATION_ID`). By default, the runner serves every organization you belong to. |

### Multi-org and multi-project support

The runner is **org-agnostic** by default: a single `ovld runner start` process will pick up work queued for any organization you are a member of, as long as the claiming target is registered in that org. This means one runner on your laptop can serve all your orgs simultaneously.

To restrict a runner to a single project or org, use `--project-id` or `--organization-id`.

### Protocol commands used by the runner

The runner communicates with Overlord through these protocol subcommands (also callable directly for automation or debugging):

```bash
# Check the current execution queue
ovld protocol list-execution-requests

# Claim the next queued request for this device
ovld protocol claim-execution \
  --device-fingerprint <fp>

# Mark a claimed request as launched successfully
ovld protocol complete-execution-launch \
  --execution-request-id <id>

# Mark a claimed request as failed
ovld protocol fail-execution-launch \
  --execution-request-id <id> \
  --error "reason"

# Clear execution requests for an objective
ovld protocol clear-execution-requests \
  --objective-id <objective-uuid>
```

---

## End-to-End Flow

```
User clicks "Run" in Overlord UI (or ovld protocol request-execution)
  │
  ▼
execution_requests row created with status=queued
  │
  ▼
ovld runner start (polling on target machine)
  │
  ├─ claim-execution: atomically marks row status=claimed
  │     └─ resolves working directory from:
  │           1. explicit workingDirectory override
  │           2. selected resource directory (target_resource_id)
  │           3. primary project_resource_directories for (project, target)
  │
  ├─ ovld launch <agent> in the resolved directory
  │     └─ agent attaches to the ticket session
  │     └─ agent runs the objective
  │
  └─ complete-execution-launch: row status=launched
```

---

## Troubleshooting

**"No primary resource directory is set for this project on this target."**
Register a directory with `ovld add-cwd` from inside the project checkout, or use the Overlord UI under Project → Settings → Execution Targets to set a primary path.

**The runner claimed a request but the agent never started.**
The claim lease will expire. Overlord detects this on the next runner poll, marks the request failed, and sends an in-app notification with a "Retry" action.

**The runner isn't picking up work for an organization.**
Confirm the execution target is associated with the organization: check Settings → Execution Targets in the Overlord UI. If the target is missing, re-register with `ovld add-cwd` from the relevant project directory.

**A target shows as org-owned but you can't edit its resource directories.**
You need ADMIN or MANAGER role in the organization, or the target must be personal and you must be the owner. Contact an org admin to adjust your role or transfer ownership.

---

## Quick Reference

| Goal | Command |
|------|---------|
| Create a project (and link the current directory in one step) | `ovld create-project --name "<name>"` |
| Register current directory as a project resource | `ovld add-cwd` |
| Start the runner daemon | `ovld runner start` |
| Run once and exit | `ovld runner once` |
| Check the execution queue | `ovld runner status` |
| List registered resource directories | `ovld protocol list-project-resources --project-id <uuid>` |
| Add a resource directory (protocol API) | `ovld protocol add-project-resource` |
| Update a resource directory | `ovld protocol update-project-resource` |
| List active execution requests | `ovld protocol list-execution-requests` |
| Clear a stale execution request | `ovld runner clear <objective_id>` |
| Rename this device's label | `ovld protocol update-device --label <name>` |
| Identify the current device | `ovld protocol get-device` |
