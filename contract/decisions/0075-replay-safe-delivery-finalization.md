# ADR 0075: Replay-safe delivery and record-work finalization

Status: accepted
Date: 2026-11-18

Amends ADR 0060 (delivery transaction) and ADR 0073 (finalization boundary consumers).

## Context

`deliverSession` checked that its session was live before taking the mission lock,
then ran Run Queue dispatch and notifications after its transaction. A lost response
followed by a retry could not be told apart from a second attempt, two concurrent
requests could both pass the session check, and a post-commit failure looked like a
rejection of an accepted delivery. `record-work` created its mission outside the
delivery transaction and had no retry identity at all. The generic `idempotency_keys`
cache is short-lived and does not commit with the delivery, so it cannot make this
boundary replay-safe.

## Decision

- Add `delivery_finalizations`: one immutable receipt per accepted `deliver` or
  `record-work`, committed in the delivery transaction, holding the actor, kind,
  optional caller operation id, the canonical digest of the validated semantic request
  and the accepted result. Unique per (workspace, actor, kind, operation id), per session
  and per delivery. Receipts live as long as their delivery and are not backfilled.
- `deliver` and `record-work` accept an optional caller-retained `operationId`. After
  current access checks, a same-id same-digest request returns the stored result
  (`replayed: true`) before any live-session requirement; a different digest is 409
  `delivery_operation_conflict`.
- Under the mission lock, `deliver` rechecks scope, the receipt and the session's live,
  undelivered state. A session that already delivered answers 409
  `delivery_already_accepted` with the existing delivery id, including historical
  sessions without receipts and requests without an operation id.
- `record-work` creates mission, completed objective, source report and receipt in one
  transaction. Concurrent same-id requests serialize on the receipt unique index; the
  loser rolls back entirely and answers from the winner. Without an id each call is new
  work; identical text is never deduplicated.
- Required follow-on scheduling (Run Queue dispatch job, next-draft approval event,
  awaiting-review notification and dispatch job, webhooks, compose job) moves into the
  finalization transaction, deduplicated by the accepted delivery. Queue selection and
  parallel-objective behavior are unchanged.
- Add the `delivery-receipt` protocol command and `overlord_delivery_receipt` MCP tool:
  the finalizing member's receipt by delivery id or operation id, in current scope.
- Retry identity belongs to the logical attempt. The CLI persists an owner-only attempt
  record (id, digest, scope; no body or secrets) before sending, reuses a pending
  attempt on rerun, and offers `--retry-operation` and `--new-operation`. MCP callers
  supply `operationId` in typed input; handlers never mint one. Later publication
  operations use the same convention.

## Consequences

Additive minor change: older clients that send no id keep working and keep the weaker
guarantee for sessionless record-work. Re-delivering an already delivered session now
answers 409 `delivery_already_accepted` instead of 401 `invalid_session`, still without
a second delivery. The narrative conflict behavior (`mission_summary_conflict`) is
unchanged in this release. A migration adds the table in both editions; it changes no
existing data.
