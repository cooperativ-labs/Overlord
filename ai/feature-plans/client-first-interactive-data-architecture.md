# Client-First Interactive Data Architecture Plan

## Objective

Move Overlord's high-interactivity desktop and web surfaces away from broad server refresh/revalidation loops and toward a client-first data architecture that gives immediate local feedback, then reconciles authoritative changes through Supabase-backed server actions or API routes.

This plan keeps Next.js as the app framework. The first migration target is data ownership: ticket/project/feed interactions should update shared client cache immediately and use server writes, realtime, and polling as synchronization paths rather than as the perceived UX path.

## Executive Summary

The current app already has several local-first fragments, but they are scoped to individual components:

- `KanbanBoard` keeps its own `tickets` state, applies local drag/create updates, then calls server actions and sometimes `router.refresh()`.
- Ticket detail live data is owned by `useTicketRealtime`, separate from board/list/calendar state.
- Feed state is owned by `FeedList`, with realtime and interval refreshes separate from ticket board state.
- New ticket and quick run modals create server draft tickets on open, then update them through multiple server actions before refreshing.
- Projects/statuses/sidebar settings apply local state in places but still refresh the route tree after mutation success.
- Offline ticket creation uses a separate localStorage queue and replay path.

The migration should consolidate these fragments into shared client data modules backed by TanStack Query. Zustand should be used only for ephemeral UI state such as open modals, selected panel ticket, drag state, visible columns, filters, and command palette state.

The recommended first milestone is not a visual rewrite. It is a data boundary:

1. Add a query client provider and typed query key/data modules.
2. Create pure ticket-board reducers that normalize board/list/calendar state.
3. Convert high-frequency ticket mutations to optimistic TanStack Query mutations.
4. Rewire `/u`, `/projects/[projectId]`, detail panels, modals, feed, projects/statuses, timers, and offline queue incrementally.
5. Defer local SQLite/local-first sync until the shared client cache and mutation semantics are stable.

## Current State Findings

### Dependency Baseline

- `@tanstack/react-query` is not currently installed in the workspace.
- `zustand` is not currently installed in the workspace.
- `@dnd-kit/*` is already installed and used by the board and status settings.
- Supabase realtime is already used directly from client components and hooks.

### Server-Rendered Board Bootstrap

[`apps/web/app/(app)/tickets/(components)/TicketsBoardContent.tsx`](<../../apps/web/app/(app)/tickets/(components)/TicketsBoardContent.tsx>) owns the current server bootstrap for `/u` and `/projects/[projectId]`:

- Reads saved view preferences and project user preferences.
- Fetches `ticket_statuses`.
- Fetches initial ticket rows per status column or calendar due-date rows.
- Fetches latest session, waiting question, and objective metadata for visible tickets.
- Fetches Everhour integration presence.
- Passes fully materialized arrays into `KanbanBoard`, `TicketListView`, or `CalendarView`.

This is a good bootstrap source for phase one, but it should become hydration input for client cache rather than the long-lived source of truth after mount.

### Board State and Refresh Loops

[`apps/web/app/(app)/tickets/(components)/KanbanBoard.tsx`](<../../apps/web/app/(app)/tickets/(components)/KanbanBoard.tsx>) is the clearest example of compensating local state:

- Maintains local `tickets`, `waitingByTicket`, `activeTicket`, `activeDragStatus`, visible columns, load-more state, and refs for realtime reconciliation.
- Reconciles `initialTickets` from server props after navigation or `router.refresh()`.
- Uses local updates for drag/drop and ticket creation.
- Uses Supabase realtime for ticket updates, ticket events, deletes, and agent sessions.
- Uses a 20 second polling fallback via `syncBoardData()`.
- Calls `router.refresh()` after `reorderTicketsAction()` to recover when realtime is unavailable.

The current implementation proves the desired UX direction is valid, but the logic is trapped inside one component and cannot be shared by list, calendar, detail, feed, or sidebar.

### Broad Server Revalidation

The highest-risk server revalidation sources are:

- [`lib/actions/tickets.ts`](../../lib/actions/tickets.ts)
  - `revalidateTicketBoards()` invalidates `/u` and `/projects` layouts.
  - Create/update/delete/status/reorder/read/unread/project/objective mutations repeatedly call broad board revalidation plus project path and detail revalidation.
  - `createBlankTicketAction`, `createTicketInColumnAction`, `createCalendarTicketAction`, `updateTicketFieldAction`, `updateTicketStatusAction`, `updateTicketPriorityAction`, `updateTicketExecutionTargetAction`, `setTicketProjectAction`, `reorderTicketsAction`, `markTicketReadAction`, `markTicketsReadAction`, `markTicketUnreadAction`, `markObjectiveExecutedAction`, `markObjectiveUnexecutedAction`, and `deleteTicketAction` all participate in broad invalidation.
- [`lib/actions/projects.ts`](../../lib/actions/projects.ts)
  - Project name/color/working-directory/SSH/Everhour updates revalidate `/u`, `/projects`, the project route, and project layout.
  - Project delete revalidates `/projects` and `/u`.
- [`lib/actions/ticket-statuses.ts`](../../lib/actions/ticket-statuses.ts)
  - Status create/delete/rename/reorder revalidate `/u`, `/projects`, the project route, and project layout.
- [`lib/actions/ticket-schedules.ts`](../../lib/actions/ticket-schedules.ts)
  - Schedule mutations revalidate `/u`, `/projects`, user detail, project detail, and current project paths.
- [`lib/actions/artifacts.ts`](../../lib/actions/artifacts.ts)
  - Artifact upload/delete paths revalidate ticket detail routes.
- [`lib/actions/everhour.ts`](../../lib/actions/everhour.ts)
  - Timer/project mapping mutations revalidate `/u`, `/projects`, ticket detail, project path, and project layout.

Server revalidation should remain available for low-frequency server-rendered routes, auth shell changes, and external writes. It should stop being the normal success path for interactive ticket/project/feed mutations.

### Client `router.refresh()` Hotspots

The primary client refresh calls that should be removed from normal interaction paths are:

- Board drag/reorder success in `KanbanBoard`.
- Calendar ticket creation in `CalendarView`.
- New ticket submit in `NewTicketModal`.
- Quick run submit in `QuickRunModal`.
- Ticket delete in `DeleteTicketButton`.
- Ticket status/project updates from ticket detail controls.
- Ticket status refresh subscription in `TicketPanelLive`.
- Project color updates in `app-sidebar`.
- Project status create/delete/reorder/rename in `ProjectStatusSettings`.
- Project name/color/settings updates in project settings modals.
- Project creator and required working-directory modals.
- Everhour timer components that call local timer refresh after action success should move to a shared timer cache.

Some refresh calls can remain outside the first migration:

- Team/org switching.
- Account/profile settings.
- Onboarding/tutorial.
- Admin model offerings.
- Auth and shell-level state changes.

### Realtime and Polling

Current realtime hooks are component/domain-local:

- [`lib/hooks/use-ticket-realtime.ts`](../../lib/hooks/use-ticket-realtime.ts)
  - Owns detail page events, artifacts, file changes, session, and shared state.
  - Uses realtime subscriptions plus a 4 second polling fallback.
- [`lib/hooks/use-feed-realtime.ts`](../../lib/hooks/use-feed-realtime.ts)
  - Subscribes to new `feed_posts`, then enriches each new row with project, ticket, objective, and file-change data.
- [`lib/hooks/use-executing-feed-tickets.ts`](../../lib/hooks/use-executing-feed-tickets.ts)
  - Reloads executing tickets on tickets/session changes and every 20 seconds.
- `KanbanBoard` has its own board-scoped realtime subscription and polling fallback.

These paths should remain, but they should write into query cache through shared reconciliation helpers rather than component-local state.

### Modal Lifecycle

[`NewTicketModal`](../../apps/web/components/features/NewTicketModal.tsx) and [`QuickRunModal`](../../apps/web/components/features/QuickRunModal.tsx) currently create a blank server ticket when the modal opens. Submit then performs multiple serialized server writes:

- project update
- assigned agent update
- objective update
- title generation and title update
- quick run status update
- agent token creation
- agent launch
- route push and refresh

This makes modal opening and initial drafting dependent on server lifecycle. It also creates abandoned draft cleanup work if the user cancels.

The client-first target should create a local optimistic draft on submit, not on open. AI title generation should be asynchronous enrichment after the ticket is already visible.

### Projects, Statuses, Sidebar

Project and status settings already perform local component updates, but they still refresh the app after server success:

- `ProjectStatusSettings` uses local status state during create/delete/reorder/rename and then calls `router.refresh()`.
- `TicketProjectSelect` updates local selection, then refreshes after project change or project creation.
- `app-sidebar` refreshes after color changes so app chrome and route data converge.
- `projects.ts` and `ticket-statuses.ts` revalidate broad route paths.

These should become optimistic project/status cache mutations. Sidebar, selectors, board columns, ticket cards, and project settings should read from the same project/status query cache.

### Feed

[`FeedList`](../../apps/web/components/features/feed/FeedList.tsx) owns fetched posts, additional posts, selected project filter, loading state, and a 60 second interval refresh. It merges realtime-only posts with fetched posts locally.

Feed should move to an infinite query or paginated query. Realtime should append/merge into the feed cache, and executing ticket status should share session/ticket identity with board/detail cache.

### Everhour Timers

[`use-everhour-timer`](../../apps/web/components/features/everhour/use-everhour-timer.ts) is already a small global store implemented manually with module-level listeners, polling, and snapshots. Timer start/stop is locally patched after action success, and several timer components call `refresh()`.

This should move to a shared query/mutation module so navbar, board card buttons, detail timer buttons, and time entry panels share the same active timer cache and optimistic state.

### Offline Ticket Flow

The offline flow is isolated from the online board mutation model:

- [`lib/offline/offline-ticket-queue.ts`](../../lib/offline/offline-ticket-queue.ts) stores queued tickets in `localStorage`.
- [`OfflineTicketForm`](../../apps/web/components/features/electron-offline/OfflineTicketForm.tsx) creates local queue entries.
- [`OfflineTicketProcessor`](../../apps/web/components/features/electron-offline/OfflineTicketProcessor.tsx) replays queued tickets with `createTicketInColumnAction('draft', ...)`.

This should converge with the shared mutation queue semantics. It can keep localStorage as a first step, but the queued item shape and replay code should use the same optimistic ticket DTO and mutation transport as online ticket creation.

## Prioritized Surface Map

| Priority | Surface | Main Interactions | Migration Phase |
| --- | --- | --- | --- |
| P0 | `/u` Kanban/list/calendar | create, delete, drag/reorder, status, read/unread, filters, view toggle, column visibility, load more | Phases 1-4 |
| P0 | `/projects/[projectId]` Kanban/list/calendar | same as `/u`, scoped by project; project statuses, hidden columns, working directory defaults | Phases 1-4, 8 |
| P0 | New ticket modal | open instantly, local draft, optimistic create, async title generation | Phase 5 |
| P0 | Quick run modal | open instantly, optimistic create, assign/model, status, launch agent, cleanup abandoned runs | Phase 5 |
| P0 | `/u/[ticketId]` and `/projects/[projectId]/[ticketId]` | inline edits, status, project reassignment, delete, schedule, objectives, artifacts, sessions | Phase 6 |
| P0 | Ticket panel/live components | events, objectives, composer, status select, due date, schedule, project select, uploads | Phase 6 |
| P1 | `/feed` | feed append/merge, running ticket execution status, project filter, pagination | Phase 7 |
| P1 | `/projects` | create, delete, rename, recolor projects; project settings entry | Phase 8 |
| P1 | Project settings and status settings | name/color, working directory, SSH, Everhour, feed instructions, status CRUD/reorder/rename | Phase 8 |
| P1 | App sidebar/nav project list | project name/color/default-project updates without app shell refresh | Phase 8 |
| P2 | `/projects/[projectId]/current-changes` | file diffs, ticket filtering, attribution, cache-first reloads | Phase 9 |
| P2 | Everhour timer surfaces | start/stop, active timer, time entries, shared navbar/card/detail state | Phase 9 |
| P2 | Offline ticket flow | queued ticket creation, replay, convergence with shared mutation model | Phase 9 |
| P3 | `/admin` | agent model offerings, admin-only low-frequency edits | Future |
| P3 | General settings | only sections affecting app chrome/defaults/selectors in near term | Future or Phase 8 if coupled |
| Out | Auth/onboarding/downloads/docs/inbox | not part of first migration unless a concrete performance issue appears | Out of scope |

### P0: Establish Data Boundary and Remove Worst Interaction Lag

1. `/u` board/list/calendar ticket data.
2. `/projects/[projectId]` board/list/calendar ticket data.
3. Ticket creation, delete, status change, drag/reorder, read/unread.
4. New ticket and quick run modals.
5. Ticket detail route/panel mutations that affect board cards.

### P1: Shared Live/Feed/Project Coherence

1. Ticket detail live domains: events, objectives, artifacts, file changes, sessions, shared state.
2. `/feed`, including executing tickets.
3. `/projects` list and project creation/settings entry.
4. Project status settings and sidebar project metadata.
5. Calendar-visible schedule/due-date updates.

### P2: Secondary Interactive Surfaces

1. `/projects/[projectId]/current-changes`.
2. Everhour timer surfaces.
3. Offline ticket queue.
4. Settings sections that affect app chrome, launch defaults, integrations, and project selectors.

### Out of First Migration

- Auth, onboarding, docs, downloads, inbox, and most account settings.
- `/admin` agent model offerings except where shared agent/model defaults need query cache.
- Full local SQLite/local-first sync.
- CLI/agent protocol contract changes.

## Target Architecture

### Framework Boundary

Keep Next.js responsible for:

- App shell, routing, auth, SSR/bootstrap data, docs, and static or low-frequency pages.
- Server actions/API routes as mutation and fetch transports.
- Web deployability and Electron-wrapped web compatibility.

Move high-interactivity state ownership to client modules:

- TanStack Query for server-derived data and mutation lifecycle.
- Pure reducers for normalized ticket/project/feed transformations.
- Zustand for UI-only state.
- Supabase realtime as reconciliation.
- Polling as scoped fallback, not the primary perceived update path.

### Data Module Layout

Recommended initial file structure:

```text
lib/client-data/
  query-client.tsx
  query-keys.ts
  realtime/
    board-reconciliation.ts
    ticket-detail-reconciliation.ts
    feed-reconciliation.ts
  tickets/
    board-types.ts
    board-normalize.ts
    board-reducers.ts
    board-selectors.ts
    board-fetchers.ts
    board-mutations.ts
    detail-fetchers.ts
    detail-mutations.ts
  projects/
    project-types.ts
    project-fetchers.ts
    project-mutations.ts
  statuses/
    status-types.ts
    status-fetchers.ts
    status-mutations.ts
  feed/
    feed-types.ts
    feed-fetchers.ts
    feed-mutations.ts
  everhour/
    timer-types.ts
    timer-fetchers.ts
    timer-mutations.ts
  offline/
    mutation-queue.ts
```

This keeps client data behavior out of route components and makes reducers testable without React.

### Query Provider

Add a client provider near the authenticated app shell:

- `QueryClientProvider`
- optional React Query Devtools gated to local development
- default retry tuned for app behavior
- mutation defaults for offline-aware retries where safe

Server-rendered route components should pass bootstrap data to client components using `initialData`/hydration. After mount, client cache becomes the source of truth for interactive surfaces.

### Query Keys

Use stable, scoped keys. A suggested key map:

```ts
queryKeys = {
  board: {
    all: ['board'],
    scope: (scope: BoardScope) => ['board', scope],
    column: (scope: BoardScope, status: string, page: PageCursor) => ['board', scope, 'column', status, page],
    calendar: (scope: BoardScope) => ['board', scope, 'calendar']
  },
  tickets: {
    detail: (ticketId: string) => ['tickets', ticketId],
    events: (ticketId: string) => ['tickets', ticketId, 'events'],
    objectives: (ticketId: string) => ['tickets', ticketId, 'objectives'],
    artifacts: (ticketId: string) => ['tickets', ticketId, 'artifacts'],
    fileChanges: (ticketId: string) => ['tickets', ticketId, 'file-changes'],
    sharedState: (ticketId: string) => ['tickets', ticketId, 'shared-state'],
    sessions: (ticketId: string) => ['tickets', ticketId, 'sessions']
  },
  projects: {
    list: (organizationId?: number) => ['projects', organizationId ?? 'all'],
    detail: (projectId: string) => ['projects', projectId]
  },
  statuses: {
    list: (organizationId: number) => ['ticket-statuses', organizationId]
  },
  feed: {
    page: (projectId: string | 'all') => ['feed', projectId],
    executingTickets: (projectId: string | 'all') => ['feed', projectId, 'executing-tickets']
  },
  everhour: {
    activeTimer: ['everhour', 'active-timer'],
    timeEntries: (ticketId: string) => ['everhour', 'time-entries', ticketId]
  }
}
```

Board scopes should be explicit:

```ts
type BoardScope =
  | { kind: 'user'; organizationId?: number }
  | { kind: 'project'; projectId: string; organizationId?: number };
```

### Normalized Core Data

Use normalized board state for shared board/list/calendar rendering:

```ts
type TicketBoardState = {
  scope: BoardScope;
  ticketsById: Record<string, BoardTicket>;
  ticketIdsByColumn: Record<string, string[]>;
  columnPageInfoByStatus: Record<string, ColumnPageInfo>;
  calendarTicketIds: string[];
  ticketStatusesById: Record<string, TicketStatus>;
  projectsById: Record<string, ProjectSummary>;
  waitingByTicketId: Record<string, string>;
  objectiveMetaByTicketId: Record<string, ObjectiveSummary>;
  agentSessionsByTicketId: Record<string, AgentSessionSummary>;
  pendingMutationsByEntityId: Record<string, PendingMutation[]>;
};
```

Separate detail domains should be cached independently but write shared ticket summaries when needed:

```ts
type TicketDetailDomains = {
  ticketEventsByTicketId: Record<string, TicketEvent[]>;
  objectivesByTicketId: Record<string, Objective[]>;
  artifactsByTicketId: Record<string, Artifact[]>;
  fileChangesByTicketId: Record<string, FileChange[]>;
  sharedStateByTicketId: Record<string, SharedState[]>;
  schedulesByTicketId: Record<string, TicketSchedule | null>;
};
```

Projects and statuses should have their own list/detail caches, then board cache should reference them by id/name.

### Reducer Rules

Create pure reducer/helper functions before moving React components:

- `normalizeBoardBootstrap(input): TicketBoardState`
- `insertOptimisticTicket(state, ticket, placement)`
- `deleteTicket(state, ticketId)`
- `updateTicketFields(state, ticketId, patch)`
- `moveTicketBetweenStatuses(state, ticketId, nextStatus, placement)`
- `reorderTicketsInColumn(state, status, orderedIds)`
- `markTicketRead(state, ticketId, isRead)`
- `mergeServerTicketRow(state, row, source)`
- `mergeRealtimeTicketRow(state, row)`
- `reconcileRemovedTicket(state, ticketId)`
- `mergeWaitingQuestion(state, event)`
- `mergeObjectiveMeta(state, ticketId, objectiveMeta)`
- `mergeSessionMeta(state, session)`
- `applyProjectChange(state, project)`
- `applyStatusCreateRenameDeleteReorder(state, statusChange)`

These reducers should not import React, Supabase, Next.js, or TanStack Query.

### Mutation Semantics

All high-frequency mutations should follow this shape:

1. Cancel affected queries.
2. Snapshot affected cache entries.
3. Apply optimistic reducer updates across all relevant caches.
4. Record pending mutation metadata on affected entities.
5. Send mutation to existing server action/API transport.
6. Merge authoritative returned DTOs into cache.
7. Clear pending metadata.
8. On error, either roll back or mark the entity failed/pending depending on UX.
9. Use narrow invalidation only when the mutation affects data outside the current cache.

Server transports should return enough data to reconcile without route refresh:

- changed ticket row
- affected project row
- changed status rows
- affected schedule row
- created/deleted entity ids
- authoritative timestamps/positions/statuses
- any side-effect rows needed by visible UI, such as latest session/objective metadata

### Realtime Semantics

Realtime should not be the path that makes the user's own interaction visible. Its responsibilities should be:

- merge external changes from agents, CLI/protocol writes, other tabs, and other users
- reconcile authoritative timestamps/positions after optimistic mutations
- fill gaps when a server mutation created related rows
- trigger scoped refetches when payloads are insufficient

Realtime event handlers should call shared query-cache reconciliation functions instead of component-local `setState`.

Polling should remain as:

- a fallback when realtime fails
- a targeted stale-query refetch on long-running surfaces
- a lower-frequency safety net in Electron CSP/offline cases

### Zustand UI State

Use Zustand for UI-only state, not server-derived entities:

- modal open state
- selected ticket/panel state
- active drag item and drag-over column
- visible columns and local view preferences
- project filter and feed filter
- command palette state
- transient focus/selection state
- temporary form drafts before submit

Do not put canonical tickets, projects, statuses, events, artifacts, timers, or feed posts in Zustand.

## Interactions That Must Stop Depending on Route Refresh

### Ticket Board/List/Calendar

- create ticket in column
- create and open ticket
- create calendar ticket
- delete ticket
- drag/reorder in a column
- move between statuses
- mark read/unread
- update priority
- update execution target
- update assigned agent/model
- update due date/schedule where visible
- load more per column
- list/calendar/board view changes that only affect client presentation

### Ticket Detail and Panel

- inline title/objective/context/tool edits
- status select
- project reassignment
- delete
- due date and schedule edits
- assigned agent/model changes
- objective executed/unexecuted state
- artifact upload/delete list updates
- live session status updates

### Modals

- opening new ticket modal
- opening quick run modal
- submit new ticket
- submit quick run
- cancel abandoned draft
- async AI title generation

### Projects, Statuses, Sidebar

- create/delete/rename/recolor project
- project working directory/SSH/Everhour mapping changes where visible in selectors/sidebar
- create/delete/reorder/rename ticket statuses
- default project changes in app chrome

### Feed and Timers

- feed load more
- new feed item append
- executing ticket status changes
- Everhour start/stop
- active timer navbar/card/detail state

## Implementation Roadmap

### Phase 0: Baseline, Guardrails, and Measurement

Goal: make the current problem measurable and prevent new broad refresh loops from being added.

Deliverables:

- Add a refresh/revalidation inventory document or checklist derived from:
  - `router.refresh()` call sites
  - `revalidatePath()` call sites
  - realtime and polling hooks
- Add lightweight instrumentation for:
  - modal open latency
  - ticket create visible latency
  - drag/drop visible latency
  - delete visible latency
  - status change visible latency
  - route refresh/remount count
  - realtime reconciliation delay
- Add a development-only warning wrapper or lint/check script for new `router.refresh()` usage in `apps/web/components/features`, ticket views, project settings, and feed surfaces.
- Document the rule: interactive surfaces must not rely on route refresh for normal success paths.

Suggested verification:

- Capture before metrics on `/u`, `/projects/[projectId]`, `/feed`, new ticket modal, quick run modal, and ticket detail.
- Confirm no user-visible behavior changes yet.

### Phase 1: Shared Ticket Board Reducers

Goal: extract board state behavior without changing rendering yet.

Deliverables:

- Add `lib/client-data/tickets/board-types.ts`.
- Add `lib/client-data/tickets/board-normalize.ts`.
- Add `lib/client-data/tickets/board-reducers.ts`.
- Add `lib/client-data/tickets/board-selectors.ts`.
- Port the existing Kanban local-state behavior into pure helpers:
  - merge initial/bootstrap tickets
  - merge realtime rows
  - optimistic create
  - optimistic delete
  - move/reorder
  - read/unread
  - waiting response state
  - agent session state
  - objective execution metadata
- Add reducer tests for:
  - creating at top/bottom of column
  - moving between columns
  - reordering within a column
  - deleting the active ticket
  - merging stale vs newer server rows
  - realtime delete of an optimistic ticket
  - session/waiting response metadata merges

Suggested verification:

- Unit tests only.
- No component behavior change until reducers are stable.

### Phase 2: Query Provider and Bootstrap Hydration

Goal: introduce TanStack Query without converting every mutation at once.

Deliverables:

- Add workspace dependencies:
  - `@tanstack/react-query`
  - `zustand`
- Add app-level `QueryClientProvider` in the authenticated app shell.
- Add `query-keys.ts`.
- Add board fetchers that can call existing server actions or API routes.
- Hydrate initial `TicketsBoardContent` data into board query cache.
- Add read-only hooks:
  - `useTicketBoard(scope, initialData)`
  - `useTicketStatuses(organizationId, initialData)`
  - `useProjects(initialData)`
- Keep current component-local state temporarily, but wire a hidden/read-only path to validate cache contents in development.

Suggested verification:

- Type check.
- Confirm initial `/u` and `/projects/[projectId]` render unchanged.
- Inspect React Query cache in development.

### Phase 3: Convert High-Frequency Ticket Mutations

Goal: make ticket interactions visible from shared cache immediately.

Deliverables:

- Add mutation hooks:
  - `useCreateTicketMutation`
  - `useCreateAndOpenTicketMutation`
  - `useDeleteTicketMutation`
  - `useUpdateTicketFieldsMutation`
  - `useUpdateTicketStatusMutation`
  - `useReorderTicketsMutation`
  - `useMarkTicketReadMutation`
  - `useUpdateTicketAssignmentMutation`
  - `useUpdateTicketScheduleMutation`
- Update server transports to return authoritative DTOs instead of `void` where needed.
- Create no-refresh variants or progressively remove broad `revalidatePath()` from high-frequency actions after cache-backed consumers are live.
- Apply optimistic updates across all mounted board scopes and ticket detail caches.
- Remove `router.refresh()` from normal success paths for converted interactions.

Suggested verification:

- Board drag/drop remains instant with realtime disabled.
- Create/delete/status/read updates are visible immediately in board/list/calendar.
- Failed mutations roll back or show failed/pending state.
- CLI/protocol-created ticket updates still appear through realtime or fallback refetch.

### Phase 4: Refactor `/u` and `/projects/[projectId]` Board/List/Calendar

Goal: make all three ticket views read from shared cache.

Deliverables:

- Convert `KanbanBoard` from component-owned canonical `tickets` state to query-derived board state.
- Keep DnD-only state local or in a small UI store.
- Convert `TicketListView` to selectors over the same board cache.
- Convert `CalendarView` to selectors over the same ticket cache plus due-date fields.
- Make load-more per status column cache-aware.
- Keep Supabase realtime subscriptions, but move handlers into query reconciliation modules.
- Keep polling fallback as scoped query refetches.

Suggested verification:

- Creating in board immediately appears in list/calendar when switching views.
- Status changes in list update board columns.
- Calendar due-date edits update board cards.
- Project-scoped and global boards do not leak tickets across scopes.
- Electron realtime failure still converges through fallback refetch without route refresh.

### Phase 5: Refactor New Ticket and Quick Run Modals

Goal: modal opening becomes purely local and submit creates optimistic records immediately.

Deliverables:

- Prefetch modal dependencies when the app/board shell mounts:
  - projects
  - statuses
  - default project
  - agent/model preferences
  - execution target defaults
  - working directory readiness
- Remove server draft creation on modal open.
- Keep form drafts in component or Zustand UI state.
- On submit:
  - generate client ticket id
  - insert optimistic ticket into board/detail caches
  - close modal immediately after accepted local validation
  - send create mutation
  - merge server row
  - generate AI title asynchronously after visible creation
- Quick run should compose:
  - create ticket
  - update assigned agent/model
  - set status to execute/next-up
  - ensure token
  - launch agent
  - navigate/open detail
- Cancel should delete only submitted optimistic/server tickets. Pure local drafts should be discarded locally.

Suggested verification:

- Modal opens without spinner from `createBlankTicketAction`.
- New ticket is visible before AI title generation finishes.
- Quick run starts agent without route refresh.
- Abandoned local drafts do not create server tickets.

### Phase 6: Refactor Ticket Detail Routes and Live Panel

Goal: detail and board share ticket identity and visible fields.

Deliverables:

- Add detail query hooks:
  - `useTicketDetail(ticketId)`
  - `useTicketEvents(ticketId)`
  - `useTicketObjectives(ticketId)`
  - `useTicketArtifacts(ticketId)`
  - `useTicketFileChanges(ticketId)`
  - `useTicketSharedState(ticketId)`
  - `useTicketSession(ticketId)`
- Convert `TicketLiveProvider` to read/write query cache.
- Remove `router.refresh()` subscription in `TicketPanelLive`.
- Inline edits update shared ticket summary cache immediately.
- Objective mutations update detail objective cache and board objective/session indicators.
- Delete/status/project/due-date changes from detail update board/list/calendar/sidebar caches.
- Artifact upload/delete updates artifact cache and any visible ticket indicators.

Suggested verification:

- Editing detail title/objective updates open board card immediately.
- Deleting from detail removes card from board and navigates away without refresh.
- Agent events append live without remounting the detail route.
- Multiple open tabs reconcile via realtime.

### Phase 7: Refactor `/feed`

Goal: feed, executing tickets, and board/detail ticket identity converge.

Deliverables:

- Move feed posts to an infinite query or paginated query.
- Replace `FeedList` interval state with query stale/refetch settings.
- Move realtime feed append into query cache.
- Avoid per-realtime-row enrichment waterfalls where possible:
  - prefer a feed DTO fetch endpoint that returns enriched rows
  - if realtime payload is sparse, insert a placeholder and trigger narrow fetch for that feed item
- Convert `useExecutingFeedTickets` to query-backed data that shares agent session/ticket identity.
- Keep project filter as UI state.
- Preserve offline feed cache as a persistence side effect of query success.

Suggested verification:

- New feed posts appear without list reset.
- Load more remains stable.
- Running ticket status matches board/detail session state.
- Project filter does not refetch unnecessarily.

### Phase 8: Refactor Projects, Sidebar, and Status Settings

Goal: app chrome and status/project selectors update from shared cache.

Deliverables:

- Add project list/detail query hooks and optimistic mutations:
  - create
  - delete
  - rename
  - recolor
  - working directory
  - SSH config
  - Everhour mapping
- Add status list query hooks and optimistic mutations:
  - create
  - delete
  - rename
  - reorder
- Convert sidebar project list and color menu to project cache.
- Convert project selectors to project cache.
- Convert `ProjectStatusSettings` to status cache.
- On status rename/delete/reorder, update board columns and ticket groupings narrowly.
- Remove app-shell refresh after project color/name/status changes.

Suggested verification:

- Sidebar reflects color/name changes immediately.
- Project selector reflects create/rename/delete immediately.
- Board columns update after status settings changes without remounting project route.
- Invalid status deletes roll back cleanly when tickets still reference the status.

### Phase 9: Secondary Interactive Surfaces

Goal: migrate lower-frequency but still interactive surfaces after core ticket identity is stable.

Current changes page:

- Wrap git status, file changes, and diff fetches in query hooks.
- Keep selected file and ticket filters local.
- Cache file-change fetches by project and file path list.
- Reconcile ticket attribution with shared ticket/project cache when available.

Everhour timers:

- Replace module-level listener store with query-backed active timer cache.
- Add optimistic start/stop mutations.
- Update ticket `everhour_task_id` in shared ticket cache when returned by server.
- Keep polling as a query refetch interval that changes when active/hidden.

Offline tickets:

- Replace ad hoc queue replay with shared mutation queue semantics.
- Keep `localStorage` persistence initially, but store the same mutation variables used by online `createTicket`.
- Surface pending offline tickets in board cache when possible.
- Replay through the same mutation hook/transport when online.

Suggested verification:

- Current changes filters and selected diff are stable across background refetch.
- Timer start/stop updates navbar, card, and detail controls together.
- Offline-created tickets replay through the same cache merge path as online tickets.

### Phase 10: Local DB / Local-First Sync Spike

Goal: decide whether a deeper local database sync layer is worth adopting after the client cache boundary is clean.

Do not begin this before phases 1-9 have stabilized.

Evaluate:

1. PowerSync + Supabase
   - Local SQLite reads/writes.
   - Supabase/Postgres compatibility.
   - Conflict handling.
   - Electron support.
   - Auth/RLS implications.
   - Operational complexity.

2. Electric + TanStack DB
   - Postgres shape sync.
   - Reactive collections.
   - TanStack DB integration path.
   - Conflict handling.
   - Electron/web parity.

3. TanStack DB abstraction
   - Whether it can wrap query-backed state before adopting a sync backend.
   - Whether it reduces migration cost or adds another temporary abstraction.

Deliverable:

- A go/no-go recommendation.
- A proof-of-concept scope if go.
- A rollback/no-adoption rationale if no-go.

## Server Transport Migration

### Short-Term

Keep existing server actions but change return values to typed mutation DTOs where needed.

Examples:

- `updateTicketFieldAction` should return the updated ticket summary or objective summary.
- `updateTicketStatusAction` should return affected ticket summaries, including scheduled duplicate rows when relevant.
- `reorderTicketsAction` should return authoritative ordered ids, positions, statuses, and affected tickets.
- `setTicketProjectAction` should return updated ticket plus old/new project ids.
- `deleteTicketAction` already returns project metadata, but should also return deleted id and organization id in a consistent DTO.
- project/status mutations should return changed rows and any affected status/project list ordering.

### Medium-Term

Introduce API route fetch/mutation endpoints only where server actions become awkward for TanStack Query, persisted mutations, or non-React clients.

Do not change CLI/agent protocol routes as part of this work. Protocol writes should remain authoritative external changes that enter the client through query refetch/realtime reconciliation.

### Revalidation Policy

During migration, server actions can keep revalidation for routes that still depend on server-rendered data.

Once a surface reads from query cache:

- remove client `router.refresh()` after successful mutations
- remove broad `revalidatePath('/u', 'layout')` and `revalidatePath('/projects', 'layout')` from high-frequency mutation success paths where no server-rendered consumer remains
- use narrow invalidation/refetch for:
  - current ticket detail
  - affected project/status query
  - feed/executing tickets if a mutation creates feed-visible side effects
  - low-frequency SSR routes that are not yet cache-backed

## Conflict and Reconciliation Rules

### Timestamps and Pending Mutations

- Each optimistic mutation should get a local `mutationId` and `submittedAt`.
- Pending rows should render normally with subtle pending state only when useful.
- Incoming realtime/server rows should merge unless they would overwrite a newer pending local field.
- When the matching mutation succeeds, authoritative values replace optimistic values.
- When an unrelated external change conflicts with a pending local mutation, prefer field-level merge where possible and surface a non-blocking conflict only for destructive or status/order conflicts.

### Board Position

Board position conflicts are likely during drag/reorder and external status changes.

Recommended initial rule:

- User's local drag result wins visually until server response.
- Server response returns authoritative order for the affected column.
- Realtime reorder events from other clients merge only when there is no pending local reorder for that column.
- Poll/refetch can repair divergence after pending mutation clears.

### Status Rename/Delete

Status mutations can affect grouping.

Recommended rules:

- Rename should update status definitions and ticket `status` values in cache when server confirms.
- Delete should optimistically remove the column only if the UI has confirmed there are no tickets in it or a replacement status is specified.
- If server rejects delete due to foreign key/ticket references, restore status list and column.

### Client-Generated Ticket IDs

New ticket mutations should generate ids client-side and pass them to the server. The current `createTicketInColumnAction` already accepts a `ticketId`, so board creation has a useful precedent.

The modal path should use the same model and stop creating server drafts on open.

## Testing Strategy

### Unit Tests

Add reducer tests for:

- normalize board bootstrap
- optimistic create/delete
- move/reorder
- read/unread
- field updates
- project reassignment
- status rename/delete/reorder
- stale realtime row ignored
- server row replaces optimistic row
- pending mutation rollback
- session/waiting/objective metadata merges

### Component/Integration Tests

Add focused tests where existing tooling supports it:

- board create shows ticket before action resolves
- failed create removes/marks failed ticket
- drag/drop updates UI before action resolves
- delete removes card before route navigation completes
- new ticket modal opens without calling create action
- quick run inserts visible ticket before title generation completes
- detail edit updates board cache
- project rename updates sidebar and selector

### Manual/Electron Verification

Verify:

- realtime disabled or failing still converges through fallback refetch
- Electron CSP cases do not require route refresh
- offline queue replay still creates tickets
- CLI/protocol-created events still appear in UI
- multiple windows/tabs reconcile external updates

## Incremental Implementation Tickets

Suggested breakdown:

1. Add query provider, query keys, and dependency baseline.
2. Add board normalization/reducers/selectors with tests.
3. Add board fetcher and hydrate `/u` read-only query cache.
4. Convert board create/delete/read/status/reorder mutations to optimistic cache updates.
5. Convert Kanban view to query-backed board data.
6. Convert list/calendar to query-backed board selectors.
7. Refactor new ticket modal to local draft and optimistic submit.
8. Refactor quick run modal to shared create/assign/status/launch mutation sequence.
9. Convert ticket detail live provider to query domains.
10. Remove ticket detail `router.refresh()` live refresh.
11. Convert feed to paginated query and realtime cache append.
12. Convert executing tickets to shared session/ticket query.
13. Convert projects/sidebar to optimistic project cache.
14. Convert ticket statuses/settings to optimistic status cache.
15. Convert Everhour timers to query-backed active timer cache.
16. Align offline ticket queue with shared mutation variables/replay path.
17. Run local DB/local-first sync spike.

Each ticket should keep existing protocol APIs compatible. External agent/CLI flows should remain server-authoritative and appear in the UI through realtime/query reconciliation.

## Acceptance Criteria Mapping

- High-interactivity surfaces are explicitly prioritized in the surface map.
- Target architecture retains Next.js and assigns TanStack Query, Zustand, realtime, polling, and server transports clear roles.
- Refresh/revalidation dependencies are identified by component/action family.
- Board/list/calendar migrate from component-local state to shared normalized cache through reducer and query phases.
- Ticket detail, modals, feed, project settings, sidebar, current changes, Everhour timers, and offline ticket flow each have a migration path.
- Local DB/local-first sync is deferred to a later spike with explicit evaluation criteria.
- Phases are scoped so CLI/agent protocol flows remain unchanged and can reconcile into the UI through existing Supabase/server writes.

## Non-Goals

- Do not replace Next.js.
- Do not start with a full local SQLite sync migration.
- Do not change CLI/agent protocol contracts.
- Do not remove Supabase realtime.
- Do not rewrite auth, onboarding, downloads, docs, inbox, or unrelated account settings as part of this migration.
