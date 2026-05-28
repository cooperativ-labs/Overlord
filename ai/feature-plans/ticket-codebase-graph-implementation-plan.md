# Ticket Codebase Graph Visualization Implementation Plan

Implementation plan for ticket **1:1193**, following the exploration in
`ai/feature-plans/ticket-codebase-graph-visualization.md`.

## Goal

Add a graph view that lets users explore how tickets relate to the codebase and to each
other through recorded file-change rationales. The graph should support a ticket compare
set, file drilldowns, codebase hotspots, replay over time, and live updates while agents
work.

## Feature Set

### Core Graph View

- Project route: `/projects/[projectId]/graph`.
- Ticket entry point: a Graph action/tab from `/projects/[projectId]/[ticketId]` that opens
  the project graph with the current ticket selected.
- URL-driven compare set: `?compare=<ticketUuid>,<ticketUuid>`.
- Ticket search/add tray with selected-ticket chips and removal controls.
- Graph canvas with pan, zoom, fit-to-view, selection, hover, and keyboard escape to clear.
- Ticket nodes colored by status/status type.
- File nodes colored by top-level directory and sized by activity/impact.
- Rationale edges from ticket to file, styled by `change_kind`, `impact`, and `confidence`.
- Edge/file details panel showing `label`, `summary`, `why`, `impact`, hunks, event,
  session/agent, objective, checkpoint, and ticket metadata.

### Relationship Discovery

- Derived co-change edges between tickets that touched the same file.
- One-hop file expansion: from a file node, add other tickets that touched that file.
- Directory clustering layout so files with the same top-level path are spatially grouped.
- Filter controls for change kind, impact, confidence, status, agent, directory, and time
  window.
- Stable dimming behavior for filtered-out nodes instead of aggressive node removal.
- Pin-and-diff lanes for comparing two tickets with shared files in the middle.

### Project Insight Modes

- Hotspot heatmap mode: files sized/colored by distinct-ticket touch count and impact score
  over a selectable window.
- Time scrubber: replay tickets, file changes, and co-change edges by `created_at`.
- Optional semantic intent layout: cluster tickets/files by the rationale text in
  `file_changes.why`.
- Optional blast-radius preview for draft tickets: ghost file edges predicted from objective
  text before work starts.

### Sharing, Realtime, and Output

- Realtime subscription to visible tickets' `file_changes` inserts/updates so new rationale
  edges fade into the graph while an agent works.
- Export current view as PNG/SVG where supported.
- Export small compare sets as Mermaid Markdown for PRs or ticket comments.
- Persist lightweight user preferences for layout mode, filters, and last hotspot window.
- Mobile fallback below the graph breakpoint: list-first relationship view with the same
  filters and drilldowns.

### Non-Goals

- AST/import dependency graphs.
- Manual graph edge editing.
- Replacing the existing `current-changes` view.
- Public unauthenticated graph sharing.

## Architecture

### Data Model

The first implementation should continue to treat `file_changes` as the source of truth.
It already contains the edge list (`ticket_id` to `file_path`) and rich edge attributes:
`label`, `summary`, `why`, `impact`, `change_kind`, `confidence`, `hunks`, `event_id`,
`session_id`, `checkpoint_id`, `objective_id`, and timestamps.

### API Surface

Add two project-scoped API routes backed by Supabase RPCs:

- `GET /api/projects/[projectId]/graph`
  - Query params: `ticketId`, `includeCompleted`, `since`, `until`, `limit`.
  - Returns graph-ready tickets, files, rationale edges, co-change metadata, and related
    event/session/objective/checkpoint fields.
  - Uses a new `get_project_graph` RPC that accepts a project id and ticket ids, with RLS
    enforced via `SECURITY INVOKER`.
- `GET /api/projects/[projectId]/graph/hotspots`
  - Query params: `windowDays`, `includeCompleted`, `directory`.
  - Returns file hotspot rows with distinct ticket count, rationale count, recent activity,
    and impact score.
  - Uses a new `get_project_hotspots` RPC.

The existing `file-changes` route can remain untouched and continue serving
`current-changes`; the graph routes can reuse its enrichment patterns.

### Frontend Layout

Proposed files:

```text
apps/web/app/(app)/projects/[projectId]/graph/page.tsx
apps/web/app/api/projects/[projectId]/graph/route.ts
apps/web/app/api/projects/[projectId]/graph/hotspots/route.ts
apps/web/components/features/projects/graph/
  ProjectGraphPage.tsx
  GraphCanvas.tsx
  GraphCompareTray.tsx
  GraphDetailsPanel.tsx
  GraphFiltersBar.tsx
  GraphModeSwitcher.tsx
  GraphTimeScrubber.tsx
  GraphMobileList.tsx
  ExportGraphMenu.tsx
  nodes/TicketNode.tsx
  nodes/FileNode.tsx
  nodes/DirectoryClusterNode.tsx
  edges/RationaleEdge.tsx
  edges/CoChangeEdge.tsx
  simulation/forces.ts
  simulation/layouts.ts
  export/mermaid.ts
  types.ts
  view-model.ts
lib/client-data/project-graph/
  hooks.ts
  query-keys.ts
  fetchers.ts
```

Use `@xyflow/react` and `d3-force` for the first renderer. Keep the graph view model
renderer-neutral enough that Sigma.js can be added later for large project graphs.

### Performance Budget

- Compare-set view should stay responsive up to roughly 10 tickets, 1,000 visible files,
  and 2,000 edges.
- Hotspot mode should default to the last 90 days and aggregate low-zoom directories.
- Use straight or simple curved edges above dense-edge thresholds.
- Use React Query with stale times similar to `current-changes`.
- Realtime updates should patch visible graph records rather than refetching the entire
  project graph for every insert.

### Permissions and Safety

- Keep all access project-scoped and membership-checked in the API route.
- Keep RPCs `SECURITY INVOKER` and rely on existing `file_changes` RLS.
- Do not expose graph data through public routes.
- Treat rationale text as sensitive ticket content.

## Phases

### Phase 1: Data Contract and Graph Skeleton

Build the backend contract and the first navigable graph route.

Deliverables:

- Supabase migration for `get_project_graph`.
- API route `GET /api/projects/[projectId]/graph` with project membership checks.
- Typed graph data model and view-model transformer.
- React Query hooks/fetchers for compare-set graph data.
- Project graph route and basic page shell.
- React Flow canvas with ticket nodes, file nodes, rationale edges, fit-view, loading,
  empty, and error states.
- URL compare-set parsing and synchronization.
- Unit tests for graph view-model derivation and API authorization/error behavior.

Acceptance:

- Opening `/projects/[projectId]/graph?compare=<ticketUuid>` shows that ticket, touched
  files, and rationale edges.
- Invalid or unauthorized projects return the same status semantics as nearby project API
  routes.
- The graph route does not regress `current-changes`.

### Phase 2: Compare Interactions and Relationship Discovery

Make the graph useful for multi-ticket exploration.

Deliverables:

- Ticket search/add tray and selected-ticket chips.
- Remove-ticket interactions that update the URL without losing layout stability.
- Edge and node details panel with rationale, hunk, event, session, objective, checkpoint,
  and ticket metadata.
- Derived co-change edges between tickets sharing files.
- One-hop file expansion to add related tickets.
- Directory-clustered force layout with stable positions while the compare set changes.
- Filters for change kind, impact, confidence, status, agent, directory, and time window.
- Focus/highlight interactions for selected tickets, files, and co-change relationships.
- Component and view-model tests for co-change derivation, filtering, and URL behavior.

Acceptance:

- Users can add and remove multiple tickets from the visualization without a page reload.
- Shared files are visible both through file nodes and ticket-to-ticket co-change edges.
- Selecting an edge or node exposes enough rationale context to understand why it exists.

### Phase 3: Insight Modes, Realtime, and Exports

Layer on the high-value analysis modes and sharing outputs.

Deliverables:

- Supabase migration for `get_project_hotspots`.
- API route and hook for hotspot data.
- Hotspot heatmap mode with configurable time window and directory aggregation.
- Time scrubber that replays edges by `file_changes.created_at`.
- Pin-and-diff lanes for two-ticket comparison.
- Realtime subscription for visible graph tickets and live edge insertion/update handling.
- Export current compare set as Mermaid Markdown.
- Export canvas snapshot as an image where browser support allows.
- Persist layout/filter preferences in project user preferences or local storage, depending
  on existing app conventions.
- Tests for hotspot scoring, time-window filtering, Mermaid export, and realtime cache
  update behavior.

Acceptance:

- Users can switch between compare, hotspot, time-replay, and two-ticket lane modes.
- New rationale records for visible tickets appear without a manual refresh.
- Mermaid export produces readable output for small compare sets.

### Phase 4: Polish, Scale Guardrails, and Mobile Fallback

Harden the feature for real projects and non-desktop layouts.

Deliverables:

- Mobile list-mode fallback with the same compare set, filters, and details panel content.
- Directory super-nodes and level-of-detail behavior for dense graphs.
- Large-graph warnings and automatic hotspot aggregation thresholds.
- Accessibility pass for keyboard navigation, focus management, reduced motion, labels,
  contrast, and screen-reader fallback content.
- Empty states for tickets without rationales, projects without graph data, and filtered
  views with no matches.
- Sentry/error instrumentation for graph API failures and renderer failures.
- Documentation or inline help entry explaining graph modes and limitations.
- Optional feature flag for an alternate Sigma.js renderer if real project data exceeds
  React Flow thresholds.
- End-to-end smoke coverage for project graph navigation and core compare interactions.

Acceptance:

- The graph remains usable on dense projects through aggregation or warnings.
- Mobile users receive a practical relationship view instead of a broken canvas.
- The feature has enough automated and manual verification coverage to ship broadly.

## Objective Breakdown

Create the following follow-on objectives on ticket **1:1193**:

1. Implement Phase 1 of the ticket codebase graph visualization: add the project-scoped
   graph data contract, graph API route, graph view model, React Query hooks, project graph
   route, and basic React Flow canvas for a URL-driven ticket compare set.
2. Implement Phase 2 of the ticket codebase graph visualization: add multi-ticket compare
   interactions, ticket search/add tray, graph details panel, co-change edges, one-hop file
   expansion, directory-clustered layout, filters, and focused relationship highlighting.
3. Implement Phase 3 of the ticket codebase graph visualization: add hotspot mode, time
   scrubber, two-ticket pin-and-diff lanes, realtime file-change updates, Mermaid/image
   exports, persisted preferences, and tests for these insight modes.
4. Implement Phase 4 of the ticket codebase graph visualization: add mobile list fallback,
   large-graph aggregation and guardrails, accessibility polish, Sentry/error
   instrumentation, user-facing documentation/help, and end-to-end smoke coverage.

## Suggested Dependency Additions

- `@xyflow/react` for graph rendering.
- `d3-force` for force-directed and directory-clustered layouts.
- Optional later: `graphology` and `sigma` if production data shows React Flow cannot
  handle hotspot-scale graphs.

## Open Decisions Before Phase 1

- Confirm whether the ticket detail entry point should be a tab, a toolbar button, or both.
- Decide whether graph preferences belong in existing project user preferences or local
  storage for v1.
- Confirm the graph route's exact placement in the project sidebar/header navigation.
- Confirm whether completed/cancelled tickets should be excluded by default in compare mode
  or only in hotspot mode.
