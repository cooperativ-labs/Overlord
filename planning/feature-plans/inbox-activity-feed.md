# Inbox Activity Feed (coo:757)

Design reference: `planning/feature-plans/inbox-activity-feed/design-reference.dc.html`
(imported from the Claude Design project `Inbox Activity Feed.dc.html`).

## Goal

The Inbox screen keeps its unallocated-capture column but gains a second, wider
column: a **time-descending feed of objective-level events** across every project
and workspace the caller can see. Four item kinds:

| Kind                 | Source                                                     | Interaction                                        |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Objective run        | `objectives.state IN ('launching','executing')`             | Opens the `MissionPanel` in a drawer, in place      |
| Blocking question    | `mission_events.type = 'ask'` still unseen                  | Opens the `MissionPanel` in a drawer, in place      |
| Delivery             | `deliveries`, newest 7                                      | Expands in place into the shared delivery card body |
| Unallocated capture  | `inbox_items` (unchanged)                                   | Existing promote-in-place flow                      |

Everything must stay live without a page refresh, and must cost one HTTP round
trip rather than one per mission.

## Non-goals

- No new realtime transport. The existing SSE `entity_changes` link plus targeted
  TanStack Query invalidation is the only update mechanism.
- No remote answering of agent requests. `POST /api/agent-requests/:id/resolve`
  is already retired (`sessionControlsGone`); the "Answer" affordance opens the
  mission panel, which is where a human answers today.
- The design's sidebar/header are demonstration chrome. Only the main section is built.

## Architecture

### 1. Contract (must land first)

Bump `Current version` in `CONTRACT.md` and `contractVersion` in
`contract/components.yaml` from `83` → `84`, add a changelog row, and document the
new read surface next to the existing delivery-read projection bullet
(`CONTRACT.md` "Backend REST" section and `contract/components.yaml` backend
`surfaces`).

New DTOs in `packages/contract/src/index.ts` (additive):

```ts
export type ActivityFeedItemKind = 'objective_run' | 'delivery' | 'blocking_question';

/** Fields every feed item carries so the card chrome is written once. */
export interface ActivityFeedItemBaseDto {
  /** Stable, kind-prefixed id (`run:<objectiveId>`, `delivery:<id>`, `ask:<eventId>`). */
  id: string;
  kind: ActivityFeedItemKind;
  /** Sort key. Descending across the whole feed. */
  occurredAt: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  projectColor: string | null;
  missionId: string;
  missionDisplayId: string;
  missionTitle: string;
  objectiveId: string | null;
  objectiveDisplayId: string | null;
}

/** One objective that is launching or executing right now. */
export interface ActivityFeedRunItemDto extends ActivityFeedItemBaseDto {
  kind: 'objective_run';
  state: Extract<ObjectiveState, 'launching' | 'executing'>;
  objectiveTitle: string | null;
  /** Bounded (<= 400 chars) instruction preview; never the whole prompt. */
  instructionPreview: string;
  agentIdentifier: string | null;
  modelIdentifier: string | null;
  branch: string | null;
  resourceKey: string | null;
  /** Session start (or execution-request creation while launching); drives elapsed time. */
  startedAt: string | null;
  /** Newest `mission_events` summary for this objective, bounded. */
  latestEventSummary: string | null;
  latestEventAt: string | null;
  /** Contiguous auto-advance objectives queued behind this one, in position order. */
  upcoming: ActivityFeedQueuedObjectiveDto[];
}

export interface ActivityFeedQueuedObjectiveDto {
  objectiveId: string;
  displayId: string;
  title: string | null;
  position: number;
  assignedAgent: string | null;
}

export interface ActivityFeedDeliveryItemDto extends ActivityFeedItemBaseDto {
  kind: 'delivery';
  objectiveTitle: string | null;
  /** The same normalized record `GET /api/missions/:id/deliveries` returns. */
  delivery: DeliveryDto;
}

export interface ActivityFeedQuestionItemDto extends ActivityFeedItemBaseDto {
  kind: 'blocking_question';
  eventId: string;
  question: string;
  agentIdentifier: string | null;
  askedAt: string;
}

export type ActivityFeedItemDto =
  | ActivityFeedRunItemDto
  | ActivityFeedDeliveryItemDto
  | ActivityFeedQuestionItemDto;

export interface ActivityFeedDto {
  items: ActivityFeedItemDto[];
  /** Server clock, so elapsed times do not drift with a skewed client. */
  generatedAt: string;
  /** Per-kind totals before truncation, for the filter chips. */
  counts: Record<ActivityFeedItemKind, number>;
}
```

`ActivityFeedItemKind` is deliberately an **open** vocabulary at the client
(unknown kinds render nothing rather than crashing), so adding a future kind
does not force another bump.

### 2. Backend — `GET /api/activity-feed`

New module `backend/activity-feed.ts` (keeps `repository.ts` from growing;
it already sits at ~8k lines). Route registered in `backend/index.ts` beside the
My Missions aggregate:

```ts
app.get('/api/activity-feed', handle(() => listActivityFeed(), {
  requires: PERMISSIONS.MISSION_READ
}));
```

**Scoping.** Reuse `callerMembershipsInActiveOrganization()` — the exact rule
My Missions already uses for "every workspace the caller belongs to". Every query
filters `workspace_id IN (<membership list>)`, so cross-workspace visibility is a
property of the membership list rather than of any per-row check.

**Query plan — five statements, no N+1:**

1. `memberships` (existing helper).
2. **Runs** — `objectives` ⟕ `missions` ⟕ `projects` ⟕ latest non-ended
   `agent_sessions` row, `state IN ('launching','executing')`, non-deleted,
   `ORDER BY updated_at DESC LIMIT 25`.
3. **Auto-advance queue** — one query for all mission ids from (2):
   `position > <current>`, `auto_advance = 1`, `state IN ('future','draft','submitted')`,
   ordered by position. Grouped in JS, truncated to the contiguous run
   (an objective with `auto_advance = 0` stops the chain — it will not run
   unattended, so listing what follows it would be a lie).
4. **Latest event per run objective** — one query using a correlated `MAX(created_at)`
   subquery (portable across the SQLite and Postgres adapters; no window functions).
5. **Deliveries** — `deliveries` ⟕ `objectives`/`missions`/`projects` ⟕ `agent_sessions`,
   `ORDER BY delivered_at DESC LIMIT 7`, normalized through the *same*
   `deliveryReportFromPayload` + row→DTO mapping `listMissionDeliveries` uses
   (extracted to a shared helper so the two projections cannot drift).
6. **Blocking questions** — `mission_events.type = 'ask'`, joined to
   `mission_status_seen` with the existing `'blocking_question'` unseen predicate,
   `ORDER BY created_at DESC LIMIT 10`.

Merged, sorted by `occurredAt DESC`, `LIMIT 40`. `payload_json` is never exposed;
instruction text and event summaries are truncated server-side.

### 3. Realtime

- `keys.activityFeed = ['activity-feed']` in `webapp/web/lib/query-keys.ts`.
- `webapp/web/lib/realtime-invalidation.ts`: add `keys.activityFeed` to the
  routed keys for `objective`, `delivery`, `mission_event`, `execution_request`,
  `agent_session`, and `mission` changes. These are exactly the rows that can
  change what the feed shows, so a targeted invalidation stays targeted.
- Inbox captures remain outside workspace realtime by contract; the unallocated
  column keeps its existing refetch behavior.
- Elapsed times tick from a local 30s interval against `generatedAt`, not from
  refetching.

### 4. Frontend

New directory `webapp/web/components/activity-feed/`:

| File                     | Responsibility                                                                    |
| ------------------------ | --------------------------------------------------------------------------------- |
| `ActivityFeed.tsx`       | Header, live/reconnecting pill from `useRealtime()`, kind + project filter chips, list, empty state |
| `ActivityFeedCard.tsx`   | Shared card chrome (project dot, mission link, display id, relative time)          |
| `ObjectiveRunCard.tsx`   | Executing/launching card + auto-advance footer                                     |
| `DeliveryFeedCard.tsx`   | Collapsed summary row; expands to `DeliveryPresentation`                           |
| `BlockingQuestionCard.tsx` | Question text + "Answer" (opens the mission panel)                               |

**Unified delivery rendering.** `DeliverySummaryCard.tsx` already exports
`DeliveryPresentation` (the structured body: markdown, blue follow-up actions,
amber tradeoffs, full-text accordion) and `deliveryOneSentenceSummary`.
`DeliveryFeedCard` composes both, so any future change to delivery presentation
lands in the mission panel and the feed at once. The collapsed/expanded shell is
also lifted out of `MissionDeliveryCard` into a shared `DeliveryCardBody` so the
two call sites share the outside-click/Escape collapse behavior too.

**Opening the mission panel without leaving Inbox.** Mirror `MyMissionsShell`:
`/inbox` becomes a shell route with an `<Outlet />`, and a child route
`/inbox/missions/$missionId` renders `<MissionDrawer><MissionPanel …/></MissionDrawer>`
with `onClose` navigating back to `/inbox`. Clicking a run or question card
navigates to that child route — the project board is never loaded.

**Layout.** `flex` row: unallocated column `flex:0 1 440px; min-width:340px` with
its own scroll, feed column `flex:1; min-width:560px` with its own scroll, both
`min-h-0` so only the inner lists scroll. Tailwind tokens
(`--color-surface-*`, `--color-ink*`, `--color-border`) replace the design's raw
oklch values so the page is theme-correct in dark mode.

### 5. Tests

- `backend/activity-feed.test.ts` — cross-workspace scoping (a mission in a
  workspace the caller does not belong to never appears), delivery cap of 7,
  auto-advance queue truncation at the first non-auto-advance objective, and
  the unseen-question predicate.
- `webapp/web/lib/realtime-invalidation.test.ts` — the six change kinds invalidate
  `['activity-feed']`.
- `webapp/web/components/activity-feed/activity-feed-model.test.ts` — pure
  merge/sort/filter helpers (kind chips, project filter, relative time).

## Sequencing

1. Contract bump + DTOs (must precede code).
2. `backend/activity-feed.ts` + route + tests.
3. Query key, API client method, realtime routing.
4. Components + `/inbox` shell route + panel child route.
5. Delivery card unification.

## Risks / tradeoffs

- **Six statements per poll.** Alternative was one UNION query; rejected because
  the three sources have genuinely different shapes and the union would need a
  lowest-common-denominator projection plus per-row re-parsing. Six indexed,
  bounded reads on a page the user visits occasionally is the cheaper trade.
- **Cap semantics.** Runs are capped at 25 and deliveries at 7. The DTO reports
  pre-truncation `counts`, so the UI can say "showing 7 of 12" instead of
  silently implying the list is complete.
- **`ask` events have no resolution row.** "Unseen" is the only truth available
  today, so a question the user has looked at but not answered leaves the feed.
  That matches the existing mission-card indicator; a durable answered-state
  would be a separate change.
