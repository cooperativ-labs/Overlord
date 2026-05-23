# Objective-First Notifications — Engineering Plan

Date: 2026-05-23
Owner: Platform / Desktop / Workflow
Status: Proposal — ready for review

## Goal

Replace the current mixed ticket-event and route-specific notification system
with one objective-first notification pipeline that:

- treats **objective state transitions** as the primary source of notification truth,
- derives a single normalized notification intent from those transitions,
- drives desktop notifications, in-app board/ticket alerts, sounds, and mobile
  push from the same handler,
- removes legacy duplicate notification logic spread across protocol routes,
  realtime listeners, and view-specific helpers.

End state:

- one canonical notification classifier,
- one canonical notification delivery orchestrator,
- one normalized set of user-facing notification kinds,
- no view-specific drift where board and ticket detail react to different events,
- no route-specific drift where `deliver`, `update --phase review`, approval gates,
  and auto-advance produce inconsistent user notifications.

## Problem Summary

The current notification behavior is inconsistent because the system has
multiple overlapping contracts:

1. Protocol routes emit different `ticket_events` depending on code path.
2. Some flows mutate ticket status or objective state without emitting the
   event types that UI listeners expect.
3. The board and ticket-detail realtime hooks use different rules for whether
   an event should produce a native desktop notification.
4. Push notifications are sent directly from server routes, while desktop
   notifications are derived later from client-side realtime listeners.
5. Newer objective-era flows such as approval-gated next objectives are layered
   onto a ticket-era event model instead of extending a single notification
   abstraction.

This creates observable drift:

- `ask` works through `question`.
- `deliver` works only because it emits an extra `status_change`.
- `update --phase review` moves state without the board review notification path.
- approval-gated queued objectives emit `awaiting_approval`, which no desktop
  listener handles.
- board and ticket detail can disagree about whether the same event should
  notify the user.

## Design Principles

1. **Objective-first**: user notifications should be driven by objective
   lifecycle changes, not by ticket status mutations alone.
2. **Single classification layer**: the rules for “should notify?” and “how
   should it notify?” must live in one shared module.
3. **Separation of concerns**:
   - state change producers record durable facts,
   - notification classifier derives normalized notification intents,
   - delivery adapters send desktop/push/in-app signals.
4. **One user-visible vocabulary**: avoid raw coupling to internal event names
   such as `deliver`, `status_change`, or `awaiting_approval`.
5. **At-most-once semantics per channel**: normalized notifications should have
   stable dedupe keys so desktop/push/realtime consumers do not double-fire.
6. **Client parity**: board view, ticket detail, desktop shell, and mobile push
   should react to the same normalized notification intent.
7. **Delete legacy code**: do not keep parallel notification systems once the
   new path is in place.

## Target Model

### Source of truth

The source of truth becomes:

- objective state transitions,
- explicit blocking agent questions,
- explicit agent alerts,
- execution queue transitions that are meaningful to a human
  (`execution_requested`, `awaiting_approval`, launch failure).

Ticket status remains important for workflow organization, but it is no longer
the primary notification trigger.

### Normalized notification intents

Introduce a small canonical notification model, for example:

- `objective_waiting_on_human`
- `objective_ready_for_review`
- `objective_auto_advanced`
- `objective_execution_started`
- `objective_execution_failed`
- `agent_alert`
- `agent_question`

Each intent should define:

- severity,
- blocking vs non-blocking,
- preferred title/body formatter,
- delivery targets:
  - in-app visual state,
  - desktop native notification,
  - sound,
  - mobile push,
- dedupe key,
- objective ID and ticket ID context,
- whether it marks the ticket unread / waiting.

### Canonical notification record

We should decide between two implementation shapes:

1. Derive intents directly from `ticket_events` + objective rows in shared code.
2. Persist a normalized durable table such as `objective_notifications`.

Recommended direction:

- start by deriving normalized intents in one shared module,
- then persist a dedicated notification record if we need stronger audit,
  dedupe, delivery receipts, or multi-client consistency.
- in either shape, normalized notification ownership should be
  **objective-scoped by default**, with `ticket_id` carried as parent context
  and projection support rather than as the primary notification key.

This keeps phase 1 smaller while still moving to one contract.

### Objective vs ticket ownership

Notification functionality should attach to objectives, not tickets, except for
projection-only UI state.

Objective-scoped responsibilities:

- waiting on human input,
- ready for review,
- auto-advance gated,
- execution requested / started / failed,
- explicit agent alert,
- explicit agent question,
- completion and review transitions.

Ticket-scoped responsibilities should be limited to projections derived from
objective notifications:

- read/unread state or its replacement,
- board attention badges,
- rollup summaries such as “this ticket has an objective waiting on you,”
- navigation context and grouping.

The design default should be:

- if a user is being notified because some unit of work changed state, that is
  an objective notification,
- if the UI is summarizing one or more objective notifications at the ticket
  level, that is a ticket projection.

The only acceptable ticket-native notification cases should be narrow
administrative events that do not belong to any meaningful objective. If those
still exist, they should either:

1. attach to a synthetic/system objective, or
2. remain explicitly exceptional cases where `objective_id` is nullable.

The recommended bias for this redesign is to avoid ticket-native notification
ownership entirely for normal workflow events.

## Proposed Architecture

### 1. Shared notification domain module

Add a shared module, likely under `lib/overlord/notifications/`, with:

- `classifyNotificationTrigger(...)`
- `buildNotificationIntent(...)`
- `formatNotificationTitle(...)`
- `formatNotificationBody(...)`
- `shouldSendDesktopNotification(...)`
- `shouldSendPushNotification(...)`
- `shouldPlayNotificationSound(...)`
- `applyBoardAttentionState(...)`

Inputs should be durable domain facts:

- ticket event row,
- related objective row or objective transition,
- ticket row,
- optional execution request metadata.

Outputs should be normalized notification intents rather than raw event names.

### 2. Server-side notification orchestrator

Add one server-side orchestrator for notification-worthy workflow changes:

- protocol routes and workflow helpers call one function when they create
  user-meaningful state changes,
- that function resolves the normalized intent,
- it writes any durable notification metadata if needed,
- it sends mobile push when configured,
- it emits enough data for clients to render the same notification locally.

This replaces ad hoc direct `sendPushNotification(...)` calls in multiple
routes with a single entry point.

### 3. Client-side realtime consumer

Board and ticket-detail realtime should stop maintaining separate rulesets.
Both should consume the same normalized notification classifier/helpers.

Concretely:

- move desktop notification and sound logic out of view-specific hooks,
- keep view-specific state updates only where necessary,
- reuse one notification consumer for:
  - board,
  - ticket detail,
  - future feed surfaces if needed.

### 4. Objective transition helpers

We currently have multiple places that independently mutate:

- objective state,
- ticket status,
- waiting/unread flags,
- follow-up `ticket_events`.

Introduce workflow helpers that make objective transitions explicit:

- `markObjectiveWaitingOnHuman(...)`
- `markObjectiveReadyForReview(...)`
- `markObjectiveExecutionStarted(...)`
- `markObjectiveExecutionFailed(...)`
- `markObjectiveAutoAdvanced(...)`

Each helper should:

- update objective state,
- update ticket-level projection fields if still needed,
- write the durable event(s),
- invoke the canonical notification orchestrator.

This is the key step that moves notification generation to the objective layer
instead of leaving it route-specific.

## Data Model Direction

## Keep

- `ticket_events` as the durable activity log.
- `objectives` as the workflow unit of work.

## Reframe

- `ticket.status` becomes a board/workflow projection of objective state, not
  the main notification trigger.
- `is_read` and `has_unopened_waiting_response` should become projections from
  normalized notification state, not ad hoc per-route flags.
- ticket-level notification semantics should be derived from objective-scoped
  notification intents rather than authored independently.

## Optional follow-up table

If phase 1 derivation proves insufficient, add a dedicated table such as
`objective_notifications` with columns like:

- `id`
- `ticket_id`
- `objective_id`
- `source_event_id`
- `intent`
- `severity`
- `is_blocking`
- `dedupe_key`
- `title`
- `body`
- `delivery_channels`
- `delivered_desktop_at`
- `delivered_push_at`
- `read_at`
- `created_at`

This should be phase 2 or later unless phase 1 shows we need durable
cross-client delivery tracking immediately.

If we add this table, it should be objective-first:

- `objective_id` is the primary workflow association,
- `ticket_id` exists for parent lookup, routing, and aggregation,
- ticket-level unread/attention state is derived from rows in this table rather
  than stored as an independent notification stream.

## Implementation Plan

### Phase 0 — Inventory and contract definition

Goal: fully map existing notification producers and consumers.

Work:

- inventory every server-side `sendPushNotification(...)` call,
- inventory every place that inserts notification-adjacent `ticket_events`,
- inventory board/ticket-detail desktop notification code,
- list all user-visible notification scenarios we need to preserve,
- define the normalized intent vocabulary and delivery rules,
- document whether each existing event maps to an intent or should be removed.

Deliverable:

- short contract doc or section in this plan with the final intent matrix.

### Phase 1 — Shared classifier and formatter

Goal: create the canonical notification interpretation layer without changing
behavior yet.

Work:

- add `lib/overlord/notifications/intent.ts`,
- add helpers that map current `ticket_events` and objective context into
  normalized intents,
- centralize title/body formatting,
- centralize sound/severity/blocking rules,
- add unit tests for all supported scenarios:
  - agent question,
  - explicit agent alert,
  - deliver to review,
  - `update --phase review`,
  - approval gate / `awaiting_approval`,
  - auto-advance execution requested,
  - execution launch failure.

Success criteria:

- board and ticket detail can both ask the same module what to show.

### Phase 2 — Client-side consolidation

Goal: remove divergent notification logic in the web app.

Work:

- refactor `apps/web/app/(app)/tickets/(components)/realtime-subscriptions.ts`
  to use shared notification helpers,
- refactor `lib/hooks/use-ticket-realtime.ts` to use the same helpers,
- centralize desktop native notification dispatch and sound playback into one
  client notification adapter,
- preserve view-specific cache updates, but delete view-specific “should notify”
  branching,
- add regression tests around desktop notification triggering behavior.

Cleanup targets:

- duplicate title/body generation logic,
- duplicate “question vs deliver vs alert” whitelists,
- view-specific event-type drift.

Success criteria:

- board and ticket detail notify on the same normalized scenarios.

### Phase 3 — Server-side orchestration unification

Goal: remove route-specific push-notification behavior.

Work:

- add a canonical server notification orchestrator, for example
  `emitWorkflowNotification(...)`,
- move push sending out of:
  - `apps/web/app/api/protocol/ask/route.ts`,
  - `apps/web/app/api/protocol/update/route.ts`,
  - `apps/web/app/api/protocol/deliver/route.ts`,
  - `apps/web/app/api/protocol/permission-request/route.ts`,
  - `lib/auto-advance/schedule-after-deliver.ts`,
- replace direct push calls with orchestrator invocations,
- ensure the orchestrator uses the same normalized intent vocabulary as the
  client classifier,
- standardize dedupe keys so repeated route retries do not produce duplicate
  push sends.

Success criteria:

- one server entry point decides whether a workflow change sends push.

### Phase 4 — Objective transition helpers

Goal: make objective lifecycle transitions the only place where notification
intents are born.

Work:

- add explicit workflow transition helpers for:
  - waiting on human,
  - ready for review,
  - auto-advanced,
  - execution started,
  - execution failed,
  - completed without review if that state exists,
- refactor protocol routes and execution helpers to use these transition
  helpers instead of hand-assembling status updates + events + pushes,
- ensure `update --phase review` and `deliver` converge on the same underlying
  transition helper,
- ensure approval-gated next objectives converge on the same “waiting on human”
  path as direct agent questions where appropriate.

Success criteria:

- notifications are tied to objective transitions, not route choice.
- normal workflow notifications do not originate from ticket-native logic.

### Phase 5 — Legacy event cleanup

Goal: remove stale ticket-era notification mechanisms.

Work:

- decide whether `status_change` remains necessary or becomes an implementation
  detail only,
- remove ticket-native notification ownership for normal workflow events,
- remove event-type-specific branching that exists only to compensate for old
  flows,
- collapse or retire redundant event names where normalized intents already
  cover the scenario,
- audit whether `awaiting_approval` should remain a raw event type or map to
  the same intent family as `question`,
- remove any dead helper functions and duplicated notification constants,
- update docs to describe objective-first notification behavior rather than
  ticket-status notification behavior.

Likely deletions/refactors:

- ticket-detail-only desktop notification whitelist logic,
- board-only `status_change` special casing as the main review notification
  trigger,
- route-level direct push formatting,
- legacy assumptions that review notification equals `deliver` event.

Success criteria:

- one efficient notification handler remains,
- legacy parallel notification code paths are deleted,
- ticket-level notification state is projection-only.

### Phase 6 — Optional durable notification store

Goal: add a persistent normalized notification table if needed.

Do this only if we need:

- reliable multi-device read state,
- push/desktop delivery receipts,
- replay/deduplication stronger than current event-based behavior,
- notification center features.

If needed:

- add `objective_notifications`,
- backfill from recent `ticket_events` if necessary,
- have clients subscribe to normalized notification rows instead of raw
  `ticket_events`.

## File and Module Plan

### New modules

- `lib/overlord/notifications/intent.ts`
- `lib/overlord/notifications/format.ts`
- `lib/overlord/notifications/orchestrator.ts`
- `lib/overlord/objective-transitions.ts`
- optional: `lib/overlord/notifications/store.ts`

### Primary refactor targets

- `apps/web/app/api/protocol/ask/route.ts`
- `apps/web/app/api/protocol/update/route.ts`
- `apps/web/app/api/protocol/deliver/route.ts`
- `apps/web/app/api/protocol/permission-request/route.ts`
- `lib/auto-advance/schedule-after-deliver.ts`
- `apps/web/app/(app)/tickets/(components)/realtime-subscriptions.ts`
- `lib/hooks/use-ticket-realtime.ts`
- `apps/web/app/(app)/tickets/(components)/realtime-helpers.ts`

### Secondary audit targets

- execution request launch/failure routes,
- record-work protocol flows,
- MCP handlers mirroring protocol behavior,
- feed generation triggers if they implicitly assume legacy event names,
- docs that describe notification semantics.

## Efficiency and Cleanup Requirements

The redesign should explicitly improve efficiency, not only correctness.

### Required cleanup goals

1. No duplicated title/body formatting logic across board, ticket detail, and
   push routes.
2. No duplicated event-type allowlists for notification decisions.
3. No extra fetches solely to decide whether a notification should fire if the
   required context is already available.
4. No view-specific realtime subscriptions that interpret the same event in
   different ways.
5. No route-specific “special extra event” emissions purely to wake up one UI
   listener if that can be replaced by the canonical transition/orchestrator.

### Recommended efficiency improvements

- prefer one classification pass per incoming event,
- cache lightweight ticket/objective display context when possible,
- keep native notification dispatch behind a single adapter with dedupe,
- avoid sending push from both the route and a later background consumer for
  the same intent.

## Testing Plan

### Unit tests

- notification intent classification for all supported event/objective cases,
- title/body formatting,
- dedupe key generation,
- channel rules by intent.

### Integration tests

- `ask` produces normalized “waiting on human” behavior,
- `deliver` and `update --phase review` produce the same review intent,
- approval-gated queued objective produces desktop + push behavior,
- auto-advance execution request produces the expected non-blocking intent,
- execution launch failure produces the expected alert intent.

### UI/realtime tests

- board view and ticket detail fire the same notification outcomes,
- unread/waiting markers stay consistent across views,
- no duplicate native notifications when the same event is processed twice.

### Manual verification

- packaged Electron build for native notification verification on macOS,
- web browser notification fallback path,
- mobile push verification,
- multi-tab / multi-window dedupe sanity check.

## Rollout Plan

### Step 1

Ship the shared classifier behind existing event producers.

### Step 2

Switch board and ticket detail to the shared classifier.

### Step 3

Switch protocol routes and helper workflows to the server orchestrator.

### Step 4

Refactor objective transitions to be the canonical producer path.

### Step 5

Delete legacy route-specific and view-specific notification code.

### Step 6

Optionally add the durable normalized notification store if phase 1-5 reveal
that raw-event derivation is not sufficient.

## Risks

### Risk: over-normalizing too early

If we delete too many raw event distinctions too early, we may lose useful
audit semantics in `ticket_events`.

Mitigation:

- keep raw activity log events,
- normalize notification intent as a separate concern.

### Risk: duplicate sends during migration

During the transition, both old and new paths may notify.

Mitigation:

- add dedupe keys immediately,
- gate rollout by feature flag if needed,
- migrate one channel at a time.

### Risk: hidden dependencies on legacy event names

Feed, analytics, or docs may rely on current event names.

Mitigation:

- inventory event consumers in phase 0,
- treat event-name cleanup as a separate explicit step.

## Open Questions

1. Do we want approval-gated queued objectives to appear to the user as the
   same notification family as direct agent questions, or as a distinct
   “awaiting approval” state?. ANSWER: same notification family as direct agent questions.
2. Should `execution_requested` and “runner claimed/launched” create visible
   notifications by default, or only update in-app state? ANSWER: visible notifications by default.
3. Do we need a durable `objective_notifications` table now, or is shared
   derivation from `ticket_events` enough for the first implementation?
4. Should `ticket.is_read` survive as a stored field, or become a projection
   from notification/read state? ANSWER: should survive as a stored field.
5. Which notification intents should produce sound vs silent desktop vs push?
   ANSWER: silent desktop and push for non-blocking intents, sound for blocking intents.

## Recommended Sequence

If we want the highest leverage path with the least churn:

1. Define normalized intents.
2. Explicitly make those intents objective-scoped, with ticket state treated as
   projection-only.
3. Consolidate board and ticket-detail client notification logic.
4. Add server orchestrator for push.
5. Refactor `deliver`, `update`, `ask`, approval gates, and execution flows
   onto objective transition helpers.
6. Delete legacy ticket-native notification code.
7. Re-evaluate whether a dedicated objective-first notifications table is still
   necessary.
