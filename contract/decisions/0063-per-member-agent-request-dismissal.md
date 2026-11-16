# ADR 0063: Per-member dismissal of an agent request's notification

- Date: 2026-11-16
- Status: accepted
- Contract version: 173.4.0
- Supersedes: none

## Context

The redesigned mission screen (web mission panel, and OverlordMobile
`docs/mission-screen-redesign-plan.md` decision 3) shows an open blocking question as a card
directly under the mission title, with a dismiss (X) control. Dismissing removes the card from the
top of the mission only: the question stays open, stays listed in its objective and in the mission
summary's actions, and can still be answered. `AgentRequestDto` had no dismissed state and the
only human write was `POST /api/agent-requests/:id/resolve`, so a dismissal could live only on one
device.

The existing `mission_status_seen` (`blocking_question`) watermark is mission-wide and shared by
every member; it drives the board's unseen dot and the Live Activity `pendingAsk`. It is a
different signal (seen, not dismissed), and sharing it would let one person hide a question from
the person who must answer it.

## Decision

1. **Per workspace member.** A dismissal belongs to one `workspace_users` row. One member
   dismissing a card never hides it from another. It is stored in the new core table
   `agent_request_dismissals (agent_request_id, workspace_user_id, dismissed_revision,
   dismissed_at)`, primary key `(agent_request_id, workspace_user_id)`, cascading with the
   request and the member.
2. **A view preference, never a decision.** Dismissing or restoring does not write
   `agent_requests`: status, revision, resolution, waiter lease, decision window, application
   state and Latch delivery are unchanged, and the request remains answerable through
   `POST /api/agent-requests/:id/resolve`. It does not touch `mission_status_seen`, the activity
   feed or Live Activities.
3. **Operations.** `POST /api/agent-requests/:id/dismissal` dismisses and
   `DELETE /api/agent-requests/:id/dismissal` restores. Both require `session:read` in the
   request's workspace, the permission that lets the caller see the card; dismissing is not
   answering, so `session:attach` is not required. Both are idempotent and return
   `{ changed, request }`. Only an open request can be dismissed (409 `agent_request_not_open`);
   restoring is allowed in any status. An optional `expectedRevision` on dismiss answers 409
   `agent_request_conflict` when the request moved on, so a client cannot dismiss a version it has
   not shown.
4. **Bound to a revision; a changed request reappears.** The dismissal records the request's
   `revision`. It applies only while the request still has that revision. Today the revision of
   an open request changes only when it leaves `open`, but any future write that materially
   changes an open request (for example a re-asked question) must bump `revision`, and the card
   then appears again without clearing anything. Stale rows are harmless and are removed with the
   request or the member.
5. **Read shape.** Every human agent-request read (`GET /api/agent-requests` in all its forms,
   and the resolve and dismissal results) carries additive `dismissed` (boolean) and
   `dismissedAt` (timestamp or null) for the calling member. They are optional in the schema so
   older clients and fixtures stay valid. A dismissed open request is still returned by the
   `status=open` paged read; clients decide where to hide it.
6. **Realtime.** A write that changes the stored state appends one `agent_request` entity change
   (`changedFields: ["dismissal"]`, the request's unchanged revision) in the same transaction.
   Clients already reload agent requests on that entity type, so another device of the same
   member updates without a manual refresh. Other members reload too and see no change.

## Consequences

- Web and mobile render the same dismissed state for a member on every device.
- The change feed reveals to workspace members that someone changed a dismissal of a request
  (the actor id), not the request's content. This is the same exposure as any other change row.
- No migration of existing data is needed; the table starts empty.
