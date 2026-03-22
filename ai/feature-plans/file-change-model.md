# File Change Model Plan

## Objective

Replace the split `artifacts` + `change_rationales` file-change model with one first-class `file_changes` table that stores both attribution and reviewer-facing rationale data.

## Current Problems

- File attribution for the Current Changes view comes from `artifacts.artifact_type = 'file_changes'`, which stores unstructured text content that has to be parsed.
- Reviewer-facing rationale metadata lives in `change_rationales`, which duplicates ticket/session/event linkage and forces the UI to make two separate reads for the same conceptual thing.
- `TicketPanelLive` can only show file changes as opaque artifacts, not as first-class rows with stable metadata.
- Feed generation and project-level review both need to understand “what files changed” and “why”, but today those answers come from different sources.

## Proposed Model

Create a new `public.file_changes` table. Each row represents one meaningful file change rationale submitted by an agent.

### Columns

- `id uuid primary key`
- `ticket_id uuid not null references public.tickets(id) on delete cascade`
- `session_id uuid not null references public.agent_sessions(id) on delete cascade`
- `event_id uuid not null references public.ticket_events(id) on delete cascade`
- `file_name text not null`
- `file_path text not null`
- `label text not null`
- `summary text not null`
- `why text not null`
- `impact text not null`
- `change_kind text not null default 'modify'`
- `attribution_source text not null default 'explicit'`
- `confidence text not null default 'explicit'`
- `hunks jsonb not null default '[]'::jsonb`
- `created_at timestamptz not null default timezone('utc', now())`
- `updated_at timestamptz not null default timezone('utc', now())`

### Why This Shape

- `ticket_id` is the upstream anchor for project and organization membership, so `project_id` and `organization_id` do not need to be denormalized into the row.
- `file_name` is stored explicitly so the UI does not need to recompute it repeatedly and can render stable labels even when different clients normalize paths differently.
- `event_id` links the rationale to the exact `update`, `record-change-rationales`, or `deliver` event that created it.
- Rationale data is stored on the same row as the file attribution, so there is no second table to join or keep in sync.

## Write Path

### Protocol and MCP

- `update`, `record-change-rationales`, and `deliver` continue accepting `changeRationales` payloads for now.
- Those payloads are persisted into `file_changes` rows instead of `change_rationales`.
- Each payload item becomes one `file_changes` row:
  - `file_path` comes from the agent payload.
  - `file_name` is derived server-side from `file_path`.
  - `ticket_id`, `session_id`, and `event_id` come from the protocol session/event context.

### Artifacts

- `file_changes` artifacts are no longer the source of truth for changed files.
- Deliver artifacts remain available for documents, notes, restart commands, migrations, test results, and URLs.
- The ticket panel should continue rendering ordinary artifacts, but file changes move into their own first-class section backed by `file_changes`.

## Read Path

### Ticket Panel

- Load recent `file_changes` rows for the ticket alongside events, artifacts, shared state, and the active session.
- Subscribe to realtime inserts on `public.file_changes`.
- Render a dedicated “File changes” section instead of relying on `artifact_type = 'file_changes'`.

### Current Changes Page

- Replace the dual-fetch model (`/change-rationales` + `/file-attribution`) with a single `/api/projects/[projectId]/file-changes` endpoint.
- That endpoint returns joined ticket, event, and session context for the matching `file_changes` rows.
- The page view model derives primary ticket, summary, and hunk matches from this single source.

### Feed

- Feed synthesis reads `file_changes` for `files_touched` and rationale context.
- `FeedCard` should treat those file paths as first-class navigable review targets by linking them to the Current Changes page.

## Migration Strategy

Because legacy rationale preservation is explicitly out of scope, the migration can be destructive:

1. Drop `public.change_rationales`.
2. Create `public.file_changes`.
3. Add indexes and RLS policies for `file_changes`.
4. Add `public.file_changes` to realtime publication.

No backfill or compatibility copy is required.

## RLS Plan

- `SELECT`: authenticated org members can read a row when they are a member of the row’s ticket organization.
- `INSERT` / `UPDATE` / `DELETE`: authenticated users with `AGENT`, `MANAGER`, or `ADMIN` in the ticket’s organization can mutate rows.

Because `organization_id` is no longer denormalized on the row, policies resolve membership through the linked ticket:

- `exists (select 1 from public.tickets t where t.id = file_changes.ticket_id and public.is_org_member(t.organization_id))`
- `exists (select 1 from public.tickets t where t.id = file_changes.ticket_id and public.has_org_role(...))`

## Frontend Impact

### `components/features/TicketPanelLive.tsx`

- Add a `fileChanges` stream from the live ticket provider.
- Render recent file changes with file link, summary, why, and impact.
- Keep the general artifacts section for non-file-change artifacts only.

### `app/(app)/projects/[projectId]/current-changes/page.tsx`

- Continue routing to the client page, but normalize the selected file query param for direct links from feed cards.

### `components/features/projects/CurrentChangesPage.tsx`

- Fetch only `/api/projects/[projectId]/file-changes`.
- Remove the separate file-attribution request and simplify the enriched-file view model around `fileChanges`.

### `components/features/feed/FeedCard.tsx`

- Present touched files as links into the Current Changes page so the feed’s file list is actionable.

## Agent Instructions

- Prompt text, CLI setup text, and MCP tool descriptions should say that `changeRationales` are persisted as structured `file_changes` rows.
- Examples should stop telling agents to send file lists as `file_changes` artifacts.
- Delivery examples should use ordinary artifacts only for non-file-change outputs such as notes, URLs, test results, and migrations.
