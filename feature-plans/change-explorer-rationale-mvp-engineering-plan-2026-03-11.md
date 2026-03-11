# Engineering Plan: Change Explorer With Ticket-Linked Rationale MVP

**Source:** Product discussion comparing Overlord with Entire and follow-up requirements for local uncommitted diff exploration
**Date:** 2026-03-11
**Status:** Planning

---

## Objective

Build an MVP "Change Explorer" for Overlord that lets users:

- inspect all current uncommitted changes inside a project's linked working directory
- browse file diffs from the Overlord UI
- click a changed hunk or line and see which Overlord ticket is most likely responsible
- read the AI-generated rationale that explains why the change was made
- access the view from a dedicated Electron-only project page at `/projects/[projectId]/current-changes`

The MVP should preserve Overlord's local-first boundary:

- repository contents and diffs are read locally from the linked working directory
- Overlord stores only ticket content, activity, and explicitly submitted rationale metadata
- uploading raw repo diffs to the server is out of scope for the MVP

---

## Executive Summary

Overlord already has the two primitives this feature needs:

- projects can be linked to a local working directory
- agent sessions already write ticket-scoped updates and deliveries

What is missing is attribution between local code changes and those ticket/session records.

The MVP should add a lightweight provenance layer based on explicit agent-submitted `change_rationale` records plus local git diff inspection:

1. The desktop app reads `git status` and `git diff` from the project's linked working directory.
2. Agents submit structured `change_rationale` objects during `update` and `deliver`.
3. Overlord stores those objects in a dedicated `change_rationales` table linked to ticket, session, and source event.
4. The Change Explorer matches each visible diff hunk to one or more rationale objects.
5. Clicking a changed hunk or line opens a popover with ticket, session, timestamp, and rationale text.

The core MVP principle is:

**Use explicit attribution first, inference second.**

That keeps the implementation reliable and keeps the agent contract clear.

---

## User Value

This feature should answer four questions quickly:

1. What is currently changed in this repository but not committed?
2. Which ticket or agent session likely caused each change?
3. Why was this change made?
4. What supporting Overlord evidence exists for that explanation?

That makes uncommitted local work reviewable in the same way Overlord already makes ticket execution reviewable.

---

## Current State

## Existing capabilities in the repo

- Projects store `local_working_directory`.
- The app already resolves linked directories and reads local file trees.
- Agents already send `update` and `deliver` events to ticket-scoped records.
- Deliveries already encourage a `file_changes` artifact with a file list or diff summary.
- Tickets and session events are already rendered in realtime.

## Missing capabilities

- No local git status or diff API.
- No UI for browsing uncommitted changes by project.
- No data model for fine-grained change attribution.
- No dedicated table for "why this code changed."
- No protocol guidance telling agents how to report change rationale in a precise, mappable way.

---

## MVP Scope

## In scope

- Electron-only route at `/projects/[projectId]/current-changes`
- project-level view of all modified, added, deleted, and untracked files from the linked working directory
- per-file unified diff rendering
- hunk-level attribution using explicit `change_rationale` objects
- line click behavior that resolves to the containing hunk and opens attribution details
- display of related ticket, session, event, timestamp, and rationale summary
- support for multiple rationales on the same hunk
- clear empty state when no rationale exists for a hunk
- protocol and prompt updates instructing agents to emit relevant `change_rationale` objects
- project settings entry point in `components/features/projects/ProjectSettingsSection.tsx`
- global hotkey for toggling into and out of the Current Changes view while in Electron

## Out of scope

- perfect line-level provenance across rebases, moved code, or repeated edits
- automatic upload of repository content or diffs to Supabase
- commit-level history browser
- blame-like tracking for already committed history
- automatic reconstruction of rationale from raw terminal transcripts
- cloud-only support when no local linked working directory exists
- exposing Current Changes in the browser-only interface

---

## Product Behavior

## Primary workflow

1. User opens the Electron-only page at `/projects/[projectId]/current-changes`.
2. Overlord reads the linked directory locally and runs git inspection commands.
3. The UI shows changed files grouped by status.
4. User selects a file and sees a diff view.
5. User clicks a changed line.
6. Overlord resolves the clicked line to its diff hunk.
7. A popover shows:
   - ticket title and identifier
   - session and event timestamp
   - rationale summary
   - optional longer explanation
   - link to the source ticket activity
   - confidence / attribution source

## Fallback states

- If the user is not in Electron: do not show the navigation affordance and redirect or block direct route access with an Electron-only message.
- If the directory is not a git repo: show a clear "Git repository required" state.
- If there are no uncommitted changes: show a clean empty state.
- If a hunk has no rationale: show "No rationale recorded for this change."
- If multiple tickets map to the same hunk: show a compact list ordered by explicitness and recency.

---

## Architecture Overview

## Local read path

The desktop app should read local repository state from the project's linked working directory using a new server route or Electron-backed route that remains local to the user's machine.

Recommended commands:

- `git rev-parse --show-toplevel`
- `git status --short --untracked-files=all`
- `git diff --no-ext-diff --unified=3`
- `git diff --cached --no-ext-diff --unified=3` only if staged coverage is desired in MVP

## Overlord evidence path

The app should fetch:

- recent `change_rationales` rows for the project's tickets
- related ticket events
- related agent session metadata

## Attribution path

The client should match local diff hunks against stored rationale references using:

1. exact `file_path`
2. explicit hunk location metadata
3. optional line range overlap
4. recency tie-break

The first version should not try to infer rationale from arbitrary text summaries. It should only match structured references.

---

## Data Model Proposal

## New table

Add a first-class table: `change_rationales`

Recommended row shape:

```json
{
  "organization_id": "<org>",
  "project_id": "<project>",
  "ticket_id": "<ticket>",
  "session_id": "<session>",
  "event_id": "<source ticket_event>",
  "file_path": "lib/auth/middleware.ts",
  "label": "Refresh auth token before permission check",
  "summary": "Moved refresh logic before auth gate.",
  "why": "Expired tokens were producing false authorization failures.",
  "impact": "Protected routes now recover cleanly when a refresh is possible.",
  "change_kind": "modify",
  "attribution_source": "explicit",
  "confidence": "explicit",
  "hunks": [
    {
      "old_start": 42,
      "old_lines": 7,
      "new_start": 42,
      "new_lines": 11,
      "header": "@@ -42,7 +42,11 @@"
    }
  ]
}
```

## Recommended columns

Required:

- `id`
- `organization_id`
- `project_id`
- `ticket_id`
- `session_id`
- `event_id`
- `file_path`
- `label`
- `summary`
- `why`
- `impact`
- `change_kind`
- `attribution_source`
- `confidence`
- `hunks jsonb`
- `created_at`
- `updated_at`

Optional later:

- `superseded_by`
- `is_user_authored`
- `notes`

## Why a dedicated table is the right architecture

This feature needs to support:

- file-path and project-scoped queries
- reliable hunk matching
- fast lookups while browsing diffs
- future deduplication and supersession
- later support for user-authored or inferred rationales

That makes `change_rationales` a first-class domain object, not just a timeline payload.

Using a dedicated table is cleaner than overloading:

- `artifacts`, which are better for review attachments and delivery payloads
- `ticket_events`, which are better for timeline entries than structured attribution records

---

## API and Protocol Changes

## 1. Extend protocol guidance

Update ticket prompt generation so agents are explicitly told to submit `change_rationale` objects whenever they make meaningful code changes.

This should be added to both:

- `update` guidance for in-progress work
- `deliver` guidance for final review handoff

## 2. Extend validation

Update protocol validation and persistence to accept structured `change_rationale` payloads and write them into the `change_rationales` table.

If `update` does not currently support structured rationale payloads directly, add one of these:

- allow `payload.changeRationales` on `update`
- or add a dedicated `record_change_rationales` protocol route

Recommendation for MVP:

- keep `deliver` support mandatory
- make `update` support optional but preferred for higher fidelity

## 3. Add local git routes

Add project-scoped local routes for:

- repo status summary
- changed file listing
- unified diff retrieval

Recommended route shapes:

- `GET /api/projects/[projectId]/git/status`
- `GET /api/projects/[projectId]/git/diff?path=<relativePath>`
- `GET /api/projects/[projectId]/git/diff-index`

These routes should:

- resolve the linked working directory
- verify the path is a directory
- verify it is inside a git repo
- return normalized JSON for UI rendering

## 4. Add rationale query route

Add a route that fetches relevant rationale rows for a project or file:

- `GET /api/projects/[projectId]/change-rationales`

Filter options:

- by `file_path`
- by recent session
- by ticket

---

## UI Plan

## Entry point

Add a new Electron-only project-level page: `Current Changes`

Recommended route:

- `/projects/[projectId]/current-changes`

Recommended placement:

- project settings section action in `components/features/projects/ProjectSettingsSection.tsx`
- optional project navigation tab once the route proves useful
- hotkey toggle in Electron only

The project-level route is the better MVP because uncommitted changes often span multiple tickets.

## Layout

### Left rail

- changed file list
- status badges: modified, added, deleted, untracked
- optional ticket count badge per file
- IDE-like narrow explorer layout sized for fast file switching

### Main pane

- unified diff viewer
- hunk anchors
- line numbers old/new
- subtle inline indicator when a hunk has attribution
- editor-like split layout with the file list pinned on the left and the selected file diff on the right

### Popover / side panel

- rationale title
- concise "why this changed" explanation
- ticket link
- event type: `update` or `deliver`
- event timestamp
- session identifier / agent
- attribution source: explicit or inferred

## Interaction model

- clicking a line selects the containing hunk
- keyboard navigation between files and hunks is desirable but optional
- hovering should not immediately open rationale details; require click for stability

## Navigation and discoverability

### Project settings button

Add a button in `components/features/projects/ProjectSettingsSection.tsx` that is only rendered in Electron and only when a working directory is configured.

Recommended behavior:

- label: `Current Changes`
- icon optional, but should read as a code or diff surface rather than generic settings
- if no working directory exists, either hide it or disable it with a tooltip explaining that a linked directory is required
- clicking navigates to `/projects/[projectId]/current-changes`

### Hotkey

Add an Electron-only hotkey that toggles between the project page and the Current Changes page.

Recommendation:

- use a project-scoped shortcut such as `Shift+Cmd+.` on macOS and `Shift+Ctrl+.` on other platforms, or another unclaimed shortcut after checking current app bindings
- if the user is already on `/projects/[projectId]/current-changes`, the same shortcut should navigate back to the prior project page when possible
- include the shortcut in the app hotkeys settings/help UI for discoverability

The key product requirement is not the exact key combination. It is that Current Changes is reachable quickly without requiring the user to hunt through navigation.

---

## Attribution Strategy

## MVP rule: hunk-level attribution

Line-level attribution should be treated as a UI affordance, not a storage contract.

For the MVP:

- agents attribute hunks
- UI lets users click lines
- system resolves line click to the containing hunk

This avoids fragile contracts when formatting or adjacent edits change individual line numbers.

## Matching algorithm

For each visible local diff hunk:

1. filter `change_rationales` by exact `file_path`
2. look for exact hunk header match
3. if header is unavailable, match by `new_start/new_lines` overlap
4. if multiple remain, prefer:
   - explicit confidence
   - latest event timestamp
   - same active session if one exists

## Confidence labels

Use simple labels:

- `Explicit`
- `Inferred`
- `Unknown`

The MVP should only generate `Explicit` and `Unknown` unless a narrow inference path is later added.

---

## Agent Instruction Design

This is the most important product-contract section of the MVP.

If agent instructions are vague, the resulting `change_rationale` objects will be noisy, redundant, or impossible to map to a diff hunk.

## Design goals for agent instructions

- ask for rationale only when it materially helps review
- make the required fields concrete and easy to fill
- minimize object count
- discourage generic summaries
- anchor each rationale to a specific file and hunk

## What agents should return

Agents should emit a `change_rationale` object only for meaningful code changes.

Meaningful means one of:

- logic change
- bug fix
- behavioral refactor
- data shape or API contract change
- validation, auth, permissions, or error-handling change
- UX behavior change that affects runtime behavior

Agents should avoid emitting `change_rationale` objects for:

- formatting-only edits
- import reordering
- generated files unless the generated output itself matters for review
- bulk rename noise unless the rename carries architectural meaning
- trivial test snapshot churn

## Recommended instruction text

Add language close to the following to the prompt:

```text
When you make a meaningful code change, include one or more `change_rationale` objects in your `update` or `deliver`.

Return only the most relevant rationales. Do not create one object per line.

Each `change_rationale` must map to a specific file and diff hunk and must explain:
- what changed
- why it changed
- the user-visible or engineering impact

Only include rationales for behaviorally meaningful changes. Skip formatting-only edits, trivial renames, import sorting, and generated-file noise unless they are important to review.

Prefer 1-5 rationale objects for a typical ticket.

Each object must include:
- `file_path`
- `summary`
- `why`
- `impact`
- either an exact diff hunk header or line ranges that identify the changed block

Keep each field concise and specific. Avoid repeating the ticket objective or generic statements like "implemented requested changes."
```

## Recommended payload schema for agents

```json
{
  "label": "<short reviewer-facing title>",
  "file_path": "components/example.tsx",
  "summary": "<what changed>",
  "why": "<why it changed>",
  "impact": "<runtime or review impact>",
  "change_kind": "modify",
  "hunks": [
    {
      "header": "@@ -10,6 +10,14 @@",
      "new_start": 10,
      "new_lines": 14
    }
  ]
}
```

## Concision rules for agent output

- prefer one rationale per logical change, not per file by default
- if one change spans multiple nearby hunks in the same file, include them in one object
- if the same rationale applies across multiple files, split it only when separate file mapping is required for review
- keep `summary` under 120 characters
- keep `why` to one sentence
- keep `impact` to one sentence

## Quality bar for acceptance

A good `change_rationale` should let a reviewer understand the purpose of a hunk without opening the full ticket history.

If a rationale cannot answer "why does this code differ from before?" it is too vague.

---

## Implementation Workstreams

## Workstream 1: Local Git Inspection

**Priority:** P0

### Goal

Expose project-scoped local git state for the linked working directory.

### Tasks

- add git helper utilities under `lib/filesystem` or a similar local-only area
- normalize status and diff command output into typed JSON
- handle missing repo, missing git binary, and invalid linked directory states
- return relative paths rooted at the repository top-level

### Acceptance criteria

- file list shows all current uncommitted changes
- diff route returns stable unified diff content for a selected file
- non-git directories fail gracefully

## Workstream 2: Structured Change Rationale Capture

**Priority:** P0

### Goal

Let agents explicitly report rationale objects in a structured, mappable format.

### Tasks

- add a `change_rationales` table, indexes, and RLS policies
- add protocol validation for structured rationale payloads
- update ticket prompt instructions with the guidance above
- support `change_rationale` on `deliver`
- optionally support `change_rationale` on `update`
- persist rows linked to ticket, session, project, and source event

### Acceptance criteria

- agents can submit valid `change_rationale` objects without protocol errors
- rows remain linked to ticket, event, and session
- rationale fields are directly queryable by project and file path

## Workstream 3: Attribution Query Layer

**Priority:** P1

### Goal

Map diff hunks to the most relevant `change_rationales` rows.

### Tasks

- create project/file scoped rationale query route
- implement hunk matching logic
- return attribution source and supporting metadata
- support multiple matches in sorted order

### Acceptance criteria

- a file with explicit rationale rows resolves correctly in the UI
- unmatched hunks show a clean no-rationale state

## Workstream 4: Change Explorer UI

**Priority:** P1

### Goal

Provide a reviewable Electron-only interface for local uncommitted changes and their rationale.

### Tasks

- add project-level route at `/projects/[projectId]/current-changes`
- gate the page to Electron
- build file list and diff viewer
- add hunk indicators for attributed changes
- add click-to-open rationale popover or side panel
- add `Current Changes` entry point to `components/features/projects/ProjectSettingsSection.tsx`
- add global hotkey toggle and document it in the hotkeys UI
- add loading, empty, and error states

### Acceptance criteria

- users can browse changed files and diffs from the app
- clicking a changed line reveals the containing hunk's rationale
- ticket links navigate back to supporting Overlord records
- the route is only available in Electron
- users can reach the page from project settings and via keyboard shortcut

## Workstream 5: Testing and Verification

**Priority:** P1

### Goal

Keep the MVP stable across git edge cases and rationale variants.

### Tasks

- unit tests for diff parsing and hunk matching
- route tests for linked directory and git repo validation
- tests for rationale validation, row creation, and metadata retention
- UI tests for rationale popover rendering and empty states
- manual verification with multi-file, multi-ticket changes

---

## Data Contracts

## Diff index response

Example:

```json
{
  "repoRoot": "/absolute/path/to/repo",
  "branch": "feature/example",
  "files": [
    {
      "path": "lib/auth/middleware.ts",
      "status": "modified",
      "additions": 4,
      "deletions": 0,
      "hasRationale": true
    }
  ]
}
```

## Rationale match response

Example:

```json
{
  "path": "lib/auth/middleware.ts",
  "matches": [
    {
      "ticketId": "ticket_123",
      "ticketTitle": "Fix auth refresh loop",
      "sessionId": "session_456",
      "eventId": "event_789",
      "eventType": "deliver",
      "createdAt": "2026-03-11T18:00:00.000Z",
      "attribution": "explicit",
      "rationale": {
        "label": "Refresh auth token before permission check",
        "file_path": "lib/auth/middleware.ts",
        "summary": "Moved refresh logic before auth gate.",
        "why": "Expired tokens were producing false authorization failures.",
        "impact": "Protected routes now recover cleanly when a refresh is possible."
      }
    }
  ]
}
```

---

## Risks and Mitigations

- Risk: agents submit too many low-value rationale objects.
  Mitigation: strict prompt language, validation shape, and UI emphasis on concise reviewer-facing summaries.

- Risk: line numbers drift after subsequent edits and break mapping.
  Mitigation: use hunk-level matching as the contract and treat line click as a hunk selector.

- Risk: users expect perfect attribution for manual edits outside Overlord sessions.
  Mitigation: show confidence labels and explicit "No rationale recorded" states.

- Risk: large diffs make the UI slow.
  Mitigation: load file list first, fetch file diffs on demand, virtualize long diff views if needed.

- Risk: local git commands fail or are unavailable in some environments.
  Mitigation: provide clear unsupported states and avoid breaking the rest of the project UI.

---

## Rollout Plan

1. Add the `change_rationales` table, protocol support, and agent prompt updates.
2. Ship local git status and diff routes behind a feature flag.
3. Build the project-level Change Explorer UI with explicit attribution only.
4. Dogfood internally on real tickets and revise prompt wording based on rationale quality.
5. Decide whether `update`-time rationale capture materially improves attribution enough to make it mandatory.

---

## Acceptance Criteria

- Users can open a project and browse all current uncommitted git changes from Overlord.
- Users can inspect a file diff and click a changed line to see the containing hunk's rationale.
- Attributed hunks show linked Overlord evidence: ticket, event, session, and rationale text.
- Unattributed hunks clearly say no rationale was recorded.
- Agents can submit concise `change_rationale` objects with enough structure for reliable hunk matching.
- The feature does not require uploading raw repository contents to Overlord servers.

---

## Open Questions After MVP

- Should Overlord support commit-linked checkpoints in addition to uncommitted diff rationale?
- Should manual user-authored rationales be allowed for unattributed changes?
- Should inference from update summaries be added, or should the product stay explicit-only?
- Should staged and unstaged diffs be shown separately?
