# Core Domain And Lifecycle

## Goal

Port the core Overlord work model into Overlord so missions, objectives, sessions, context, and review history behave consistently before any web app or auth layer exists.

## Required Concepts

### Instance

The local Overlord installation. For the MVP, one local instance can act as one implicit organization/workspace.

Requirements:

- Has a human-readable name and backend URL from `overlord.toml`.
- Reaches persistence through the configured backend; local SQLite is owned by
  Desktop/local backend packages, not by the published npm CLI.
- Provides defaults for web port, default agent/model, terminal launcher, and connector locations.
- Can later support multiple users, roles, and authentication without changing the mission/objective workflow semantics.

### User

A user is the human identity that owns missions, creates credentials, and receives permissions. For the local MVP, Overlord uses the first locally created authenticated account as the trusted operator.

Requirements:

- Reserve a user concept for future auth, roles, permissions, and audit attribution.
- Support both human users and persistent service-style users for agents or runners without creating a separate identity primitive.
- Attribute created missions, sessions, events, deliveries, and `USER_TOKEN` records to a user once auth is enabled.
- User-owned `USER_TOKEN` credentials initially inherit all current permissions of the creating user.
- Future scoped token permissions should restrict the creating user's permissions, not create a separate agent identity.
- Disabling or soft-deleting a user should also invalidate that user's effective token access.
- Future role-based access control should use default `ADMIN` and `MEMBER` roles, with only administrators able to add, remove, or change roles for other users unless a custom authorization provider says otherwise.

### Project

A project is the top-level work container and normally maps to one repository checkout.

Requirements:

- Create, list, inspect, rename, archive/delete projects.
- Store a project name, stable identifier, optional description, default agent/model settings, and workflow/status configuration.
- Link one or more local resource directories.
- Identify one primary local resource directory for each execution target in later phases.
- Support project discovery from the current working directory.
- Write local project metadata to `.overlord/project.json` when a directory is linked.
- Reserve `.overlord/tmp/` and `.overlord/logs/` for local ephemeral runtime data.

### Mission

A mission is the durable goal and review record.

Requirements:

- Human-readable mission identifier such as `1:1204` can be retained for compatibility, but MVP can also support a simple local sequence.
- The default human-readable mission sequence is workspace-scoped. If project-scoped sequences are introduced later, treat that as a schema migration rather than a config-only change.
- Fields should cover title, objective summary, status, priority, project, constraints, human-only notes (never sent to agents), output format, creator, timestamps, and execution target intent.
- Missions contain ordered objectives. By default at most one objective executes
  at a time. A mission may opt in to parallel execution (`allowParallelObjectives`)
  on different `resource_key`s or the same one; a same-resource pair gets a
  per-objective branch and worktree when the mission uses worktrees, and shares the
  mission's single checkout when it does not.
- Missions retain activity history, delivery records, artifacts, attachments, shared context, and change rationales.
- A mission can be agent-executable or human-only.
- Mission content is persistent and should be treated as shared project memory.

### Objective

An objective is one agent pass inside a mission.

Requirements:

- One objective maps to one agent session.
- Objectives are ordered.
- Each objective has instruction text, optional title, state, assigned agent, model, agent flags, attachments, auto-advance flag, and execution metadata.
- Attachments are scoped to objectives, not generic missions.
- New objectives should be added to the same mission when they are sequential steps toward the same goal.
- New missions should be created when the work is a distinct feature, bug, investigation, or review goal.

Objective states to support:

- `future`: hidden or queued future work, optional for MVP but useful for planned chains.
- `draft`: editable objective not yet submitted for execution.
- `submitted`: ready for an agent or runner.
- `launching`: queued/claimed by runner before attach.
- `executing`: attached to an active agent session.
- `pending_delivery`: follow-up execution happened after a previous delivery and needs redelivery.
- `complete`: delivered and no longer active.

### Agent Session

A session is the live attachment between an agent and an objective.

Requirements:

- Created by `ovld protocol attach`, `prompt`, or `connect`.
- Stores a session key used by subsequent protocol commands.
- Tracks agent identifier, model identifier, connection method, native external session ID when available, start/end timestamps, phase, liveness heartbeat, and delivery state.
- Can record progress updates, blocking questions, permission requests, artifacts, change rationales, shared context writes, and final delivery.
- Connector callbacks capture exact, objective-bound path evidence in a local objective/session ledger. Protocol update, preflight, and delivery drain that evidence independently of the progress or delivery payload.
- Durable changed-file identity is `(objective_id, file_path)` across sessions; the observing session remains provenance rather than part of the identity.
- Attach should be idempotent enough for agent retries and re-attachments.

### Shared Context

Shared context is durable mission memory for future sessions.

Requirements:

- Key/value entries scoped to a mission.
- Values should accept JSON or string content.
- Optional tags.
- Read/filter by key substring and limit.
- Used for stable facts, not full transcript duplication.

### Event History

Mission events are the durable timeline.

Required event types:

- `update`: normal progress.
- `heartbeat`: transient session liveness; does not need to appear as a mission event.
- `user_follow_up`: verbatim human follow-up after initial mission.
- `alert`: non-blocking warning.
- `discussion_summary`: important non-file conclusion.
- `decision`: explicit decision.
- `ask`: blocking question.
- `permission_request`: agent needs tool permission.
- `delivery`: final or follow-up delivery.
- `execution_requested`: objective queued for runner.
- `awaiting_approval`: auto-advance stopped for human approval.
- `status_change`: mission or objective state transition.

## Mission Status Requirements

Overlord should separate mission statuses from objective states.

Mission status types:

- `draft`: not ready or backlog/planning.
- `next`: queued to start soon, but not yet active.
- `execute`: active work.
- `review`: delivered or needs human review.
- `complete`: finished.
- `blocked`: blocked or waiting for human resolution.
- `cancelled`: intentionally stopped.

Every project is seeded with this default set of status names:

- `Backlog` (`backlog`)
- `Next Up` (`next_up`)
- `In Progress` (`in_progress`)
- `In Review` (`in_review`)
- `Complete` (`complete`)
- `Blocked` (`blocked`)
- `Cancelled` (`cancelled`)

Requirements:

- `Next Up` is a seeded status name mapped to the stable `next` status type.
- Status names, order, and count are configured **per project**, in project settings.
  Two projects in the same workspace may name and order their columns differently;
  status type semantics remain stable across every project.
- A mission's status always belongs to that mission's own project. Status *ids*
  are therefore project-local and must never be carried across projects; the
  stable `type` is what every filter, side effect, and webhook payload is
  expressed in.
- `ovld statuses list --project-id <id>` (and the `overlord_list_project_statuses`
  MCP tool) reads one project's status names — the only way to discover a
  specific board's columns.
- Only one project status may have each exclusive `next`, `execute`, and `review` type.
- Only one active default status should exist per project.
- CLI update phases can include `draft`, `execute`, `review`, `deliver`, `complete`, `blocked`, and `cancelled` for protocol compatibility.
- Soft deletion is represented by `deleted_at` in the schema, not by adding `deleted` or `removed` lifecycle statuses.

## Lifecycle Requirements

### Normal Agent Flow

1. Human or CLI creates a mission with at least one objective.
2. Objective is submitted or queued.
3. Agent attaches.
4. Objective moves to `executing`.
5. Agent posts progress updates or heartbeats.
6. Agent asks a blocking question if needed and stops.
7. Agent delivers summary, artifacts, and change rationales.
8. Objective moves to `complete`; mission moves to `review`.
9. If another draft objective exists and auto-advance is enabled, Overlord queues it for runner execution.

### Follow-Up Flow

Requirements:

- Delivered missions remain in review during discussion.
- Ordinary discussion, clarification, decisions, and summaries do not reopen execution.
- Explicit file/code work after delivery requires a `begin-follow-up-work` signal.
- Work signals after delivery move the objective to `pending_delivery`.
- A follow-up delivery moves it back to `complete`.

### Blocking Flow

Requirements:

- `ask` records a precise blocking question.
- The mission should move to a review/blocked-visible state.
- The agent should stop after asking.
- A later human answer should be recorded as `user_follow_up` or `decision`.

## Acceptance Criteria

- A mission with multiple objectives can be created and inspected entirely from the CLI.
- Attaching to a mission returns the correct active objective rather than only the mission title.
- Objective state changes are auditable in event history.
- Mission status changes do not destroy objective ordering or session history.
- Follow-up discussion does not force redelivery unless new execution work is recorded.
- Shared context written by one objective is visible to later objectives on the same mission.
