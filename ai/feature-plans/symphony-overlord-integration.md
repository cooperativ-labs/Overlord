# Symphony-style Runner Integration Plan

## Objective

Evaluate how Overlord should fit with Symphony-style agent runners, where an external service polls work, creates isolated workspaces, launches agents, and reconciles each run independently.

The recommendation is to make Overlord the work control plane and human-facing UX for those runners, not the runner itself.

## Source Context

OpenAI's Symphony project defines a long-running service that reads tracker work, creates one workspace per issue, starts a coding-agent session inside that workspace, and exposes enough observability to operate many concurrent runs.

Relevant Symphony design points:

- Symphony is explicitly a scheduler, runner, and tracker reader.
- It keeps policy in a repo-owned `WORKFLOW.md`, including tracker settings, workspace hooks, agent concurrency, Codex launch settings, and a prompt template.
- Its tracker adapter contract is small: fetch candidate issues, fetch issues by state, and refresh states for active issue IDs.
- It treats ticket writes as a boundary: comments, state transitions, PR links, and handoff updates usually happen through the coding agent and its tools, not through the scheduler.
- It makes a human-readable status surface optional; correctness comes from orchestrator state and logs.
- Its Elixir demo polls Linear, creates a workspace per Linear issue, launches Codex app-server mode, and keeps Codex working until the issue reaches a workflow-defined handoff state.

Sources:

- https://github.com/openai/symphony
- https://github.com/openai/symphony/blob/main/SPEC.md
- https://github.com/openai/symphony/blob/main/elixir/README.md
- https://openai.com/index/harness-engineering/

## Current Overlord Fit

Overlord already has most of the control-plane surface a Symphony-style runner needs:

- `tickets` provide the task source.
- `objectives` provide the work item body that should become the runner prompt input.
- `agent_sessions` provide durable per-run identity with `session_key`, `external_session_id`, `external_url`, `metadata`, heartbeat, and lifecycle state.
- `ticket_events` provide the user-visible activity stream.
- `artifacts`, `shared_state`, and `file_changes` provide structured proof-of-work storage.
- The protocol already supports `discover-project`, `attach`, `connect`, `load-context`, `spawn`, `update`, `record-change-rationales`, `ask`, `read-context`, `write-context`, and `deliver`.
- The ticket panel already renders activity, active sessions, external agent links, artifacts, shared state, and file changes through realtime data.

This means Overlord does not need to own workspace creation, container orchestration, subprocess management, retry loops, or Codex app-server lifecycle. It should expose clean task and telemetry APIs that make external runners legible to users.

## Product Positioning

Overlord should be the UX layer for autonomous work execution:

- users create, prioritize, schedule, and review tickets in Overlord
- external runners claim eligible tickets
- external runners execute in their own isolated environments
- agents and runners stream meaningful state back to Overlord
- humans watch progress, answer questions, inspect proof, and accept or requeue work in Overlord

This fits Symphony's direction and avoids competing with harness engineering. Users can run Symphony, a lab-provided runner, or their own orchestration stack while Overlord remains the shared cockpit.

## Recommended Integration Shape

### 1. Add an Overlord tracker adapter contract

For Symphony-style systems, Overlord should behave like a tracker backend.

The first integration target can be a documented `tracker.kind: overlord` adapter that implements Symphony's tracker operations:

- `fetch_candidate_issues()`
- `fetch_issues_by_states(state_names)`
- `fetch_issue_states_by_ids(issue_ids)`

Overlord ticket normalization should map to Symphony's issue model:

- `id`: ticket UUID
- `identifier`: `OVLD-<ticket_sequence>` or the ticket short ID
- `title`: ticket title
- `description`: objective plus ticket context, constraints, acceptance criteria, and available tools
- `priority`: mapped from `urgent`, `high`, `medium`, `low`
- `state`: current Overlord ticket status name
- `url`: canonical Overlord ticket URL
- `labels`: project, delegate, execution target, assigned agent, and optional future tags
- `blocked_by`: future objective/ticket dependency references
- `created_at` and `updated_at`: ticket timestamps

The adapter should prefer status types over literal status names where possible, because Overlord supports organization-defined status names. For example, the runner should be able to ask for tickets whose status type is draft/execute/review/complete rather than hard-code `next-up`, `execute`, or `review`.

### 2. Introduce runner-safe claim semantics

Current `attach` is agent-oriented and moves the ticket into execute. That works for a single launched session, but Symphony-style runners may run as always-on schedulers and need an idempotent claim/lease operation.

Recommended API:

- `POST /api/protocol/runner/claim`
- input: project scope, candidate status filters, runner ID, lease duration, concurrency metadata
- output: one or more ticket IDs plus prompt context or normalized issue payloads
- behavior: atomically marks tickets as claimed/executing, creates an `agent_sessions` row, and returns a session key per claimed ticket
- failure mode: if a lease expires without heartbeat, the ticket becomes eligible for retry/reclaim according to policy

This keeps duplicate runners from picking the same ticket and gives Overlord a durable session before work starts.

### 3. Treat runner telemetry as first-class, but summarized

Runners should not push every raw agent event into `ticket_events`. The UI needs meaningful state changes, not an unbounded terminal transcript.

Recommended event model:

- Use `agent_sessions.metadata` for stable run facts:
  - runner name/version
  - workflow file path and hash
  - workspace path or container ID
  - attempt number
  - agent command
  - runner host
  - repository/branch
- Use `agent_sessions.external_session_id` for the runner's native run/session ID.
- Use `agent_sessions.external_url` for the Symphony dashboard, container logs, PR, or hosted run page.
- Use `ticket_events` for human-meaningful milestones:
  - claimed
  - workspace created
  - agent started
  - agent progress summary
  - tests running/passed/failed
  - PR opened
  - review requested
  - runner stalled/retrying/cancelled
  - runner needs human input
- Use `payload` for structured detail:
  - `source: "symphony"`
  - `runner_event_type`
  - `workspace_path`
  - `attempt`
  - `thread_id`
  - `turn_id`
  - token totals
  - rate limit snapshot
  - log/artifact references

This preserves Overlord as a readable UX instead of turning it into a log viewer.

### 4. Add a run telemetry table or typed session metrics

Symphony's optional runtime snapshot includes running sessions, retrying sessions, token totals, runtime seconds, and rate-limit payloads. Overlord can represent some of this today via session metadata and events, but a first-class model would make the UI much better.

Recommended v1 schema direction:

- `agent_run_metrics`
  - `session_id`
  - `ticket_id`
  - `attempt`
  - `turn_count`
  - `input_tokens`
  - `output_tokens`
  - `total_tokens`
  - `seconds_running`
  - `last_event_type`
  - `last_event_summary`
  - `last_event_at`
  - `rate_limits`
  - `retry_due_at`
  - `runner_state`

Alternatively, add a typed `runtime` JSONB column to `agent_sessions` as a lower-cost first step. A table is cleaner if we expect frequent updates and dashboard queries.

### 5. Make proof-of-work ingestion runner-friendly

Symphony emphasizes proof of work: CI status, PR review feedback, complexity analysis, walkthrough videos, and safe landing signals.

Overlord already has artifacts and file changes. The missing piece is a runner-friendly proof contract:

- `record-check-result`
  - name, status, URL, summary, metadata
- `record-pr`
  - provider, repo, PR number, URL, title, branch, status
- `record-review-feedback`
  - reviewer, status, URL, summary
- `artifact-finalize-upload`
  - already suitable for videos, logs, reports, and generated docs
- `record-change-rationales`
  - already suitable for file-level reasoning

These can be protocol extensions without requiring Overlord to call GitHub, run CI, or merge PRs itself.

### 6. Keep tracker writes out of the runner core

The Symphony spec says tracker writes usually live in agent tooling and prompts, not the scheduler. Overlord should keep the same boundary.

The runner should:

- claim work
- report lifecycle telemetry
- attach external run links
- keep heartbeat/lease state current
- report runner failures

The agent should:

- update ticket progress
- ask questions
- write context
- record file changes
- upload artifacts
- deliver final work

The runner may perform defensive failure updates when the agent crashes or stalls, but it should not encode project-specific ticket business logic.

### 7. Provide a reference `WORKFLOW.md` for Overlord tickets

Symphony's repo-owned workflow contract is useful. Overlord should provide a template workflow that uses Overlord tickets as the issue source.

Example shape:

```md
---
tracker:
  kind: overlord
  endpoint: "$OVERLORD_URL"
  project_id: "..."
  active_status_types: ["draft"]
  terminal_status_types: ["complete", "cancelled"]
workspace:
  root: "$OVERLORD_WORKSPACE_ROOT"
agent:
  max_concurrent_agents: 4
codex:
  command: codex app-server
---
You are working on Overlord ticket {{ issue.identifier }}.

Title: {{ issue.title }}

{{ issue.description }}

Before doing work, attach to Overlord using the supplied session key if one exists. Keep the ticket updated with meaningful progress and deliver structured proof of work.
```

If the runner creates the Overlord session itself, the prompt should include the session key and ticket ID. If the agent creates the session, the prompt should include the normal `ovld protocol attach` command.

## UI Opportunities

The Overlord ticket panel should become the place where non-runner users understand autonomous work.

Recommended additions:

- A "Run" summary card sourced from `agent_sessions` and run metrics:
  - runner name
  - attempt
  - workspace/container
  - elapsed time
  - last heartbeat
  - retry/stall state
  - external run link
- A "Proof" section:
  - PR
  - CI
  - review feedback
  - walkthrough video
  - complexity/risk report
- A compact runner event timeline distinct from the agent conversation.
- A board-level executing view that shows many concurrent tickets, their runner state, and which ones need human attention.
- A requeue/cancel affordance that updates Overlord state and lets the external runner reconcile on its next poll.

The UI should not expose container controls as if Overlord owns them. It should show external state and provide ticket-level decisions.

## Minimal Implementation Path

### Phase 1: Use existing protocol with a thin adapter

- Build a proof-of-concept Symphony tracker adapter outside Overlord.
- Use existing `/api/protocol/tickets`, `attach`, `update`, and `deliver` where possible.
- Store runner fields in `agent_sessions.metadata`, `external_session_id`, and `external_url`.
- Use regular `ticket_events` for summarized milestones.
- Document the recommended event payload shape.

This validates product fit without schema work.

### Phase 2: Add lease/claim and metrics

- Add a runner claim endpoint with atomic ticket/session creation.
- Add heartbeat/lease expiry behavior.
- Add either `agent_run_metrics` or typed session runtime metadata.
- Render a simple run summary card in the ticket panel.

This makes the integration robust for multiple runners.

### Phase 3: Add proof-of-work protocol extensions

- Add typed PR/check/review proof endpoints.
- Add a Proof section in the ticket panel.
- Add board-level filters for "needs human", "failed", "retrying", and "ready for review".

This makes Overlord materially better than a generic issue tracker in agent-runner workflows.

## Design Boundaries

Overlord should not:

- create workspaces
- start containers
- launch Codex app-server
- manage subprocesses
- implement retry backoff for runner-owned failures
- parse full raw agent logs as primary UI
- own project-specific PR landing policy

Overlord should:

- own ticket creation, priority, status, schedule, and review UX
- provide a stable tracker adapter surface
- provide a stable session/event/proof protocol
- make many isolated runs legible to humans
- persist human decisions and agent proof-of-work
- let agents and runners link back to their native external systems

## Key Risks

- Without claim/lease semantics, two external runners can pick the same ticket.
- Without typed metrics, frequent runner updates will either spam `ticket_events` or become opaque JSON blobs.
- Without proof-of-work structure, Overlord will only show narrative summaries and lose the main value of Symphony-style autonomous runs.
- If Overlord tries to own runner operations, it will compete with harnesses instead of integrating with them.
- If status mapping relies on literal names, organization-customized board states will break runner adapters.

## Recommendation

Build Overlord's Symphony integration as a tracker-plus-telemetry contract:

1. Document `tracker.kind: overlord` and a normalized issue payload.
2. Add atomic runner claim/lease semantics.
3. Add typed run metrics or typed runtime metadata.
4. Extend proof-of-work ingestion for PRs, checks, reviews, and videos.
5. Improve the ticket panel around run state, proof, and human attention.

This lets Overlord become the UX for autonomous execution without becoming the execution harness.
