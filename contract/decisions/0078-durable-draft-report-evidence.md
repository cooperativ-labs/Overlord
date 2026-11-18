# ADR 0078: Durable draft report evidence and atomic report sealing

Status: accepted
Date: 2026-11-18

Builds on ADR 0075 (replay-safe finalization) and ADR 0076 (agent-only mission narrative).
Amends ADR 0060 only in that a draft-aware delivery's authored V1 report is assembled from
sealed draft entries; item identity, reconciliation and supersede rules are unchanged.

## Context

An agent learns most of its report while working: a risk noticed early, a decision taken
midway, an assumption later confirmed. Today the only place for that evidence is the final
`deliver` payload, so discoveries made before a context compaction or a restart are easy to
lose, and nothing records what was observed but later resolved. Simply storing per-entry
rows is not enough: entry ids identify observations, not write attempts, so a batch whose
response was lost cannot be replayed safely once a later batch edited the same entry
(review R3). Publishing provisional evidence as live mission items would also create
obligations before the work was accepted.

## Decision

- Add three tables in both editions. `delivery_report_drafts`: one draft per protocol
  session, owned by its member, with a CAS `revision`, bounded `batch_count` and
  `entry_count`, and `sealed_at`/`sealed_delivery_id`. `delivery_report_draft_entries`:
  stable client entry ids per draft over the closed kinds `human_action`, `tradeoff`,
  `known_risk`, `deferred_work`, `assumption`, with bounded content validated by the
  existing delivery-report schemas, position, withdrawal, import source and the sealed V1
  reference. `delivery_report_draft_batches`: one immutable receipt per accepted batch
  (caller operation id, canonical digest, result revision, attributable event id).
- `update` accepts opt-in `reportDraft { operationId, expectedRevision, operations }`.
  Under the mission lock a batch applies atomically with its receipt and one ordinary
  update event that carries only bounded metadata. The receipt is looked up before the
  revision check and before the session must be live: the same id and digest replays the
  original event id and revision without writing; a changed request under the same id is
  409 `report_draft_operation_conflict`. A replay after sealing or session end is a
  currently authorized receipt read and never regains update authority. A stale revision
  applies nothing and returns the fresh draft (409 `report_draft_conflict`).
- Retained history is bounded explicitly: 12 active entries per kind (the V1 item limit),
  1,000 accepted batches and 1,000 distinct entry ids per draft. Writes beyond a bound are
  refused (409 `report_draft_limit_exceeded`); nothing is pruned, so the replay guarantee
  holds for the life of the draft.
- Add the `report-draft` protocol command and `overlord_report_draft` MCP tool: the
  caller's own draft with a final inspection (the normalized, eligibility-filtered report
  `deliver` would seal, entry references and exclusion warnings), abandoned drafts of the
  objective, and explicit reads of abandoned or sealed drafts. Attach and resume-follow-up
  add a compact `reportDraft` baseline. A replacement execution may import selected
  abandoned entries explicitly; it never inherits the old session's write rights.
- `deliver` accepts `reportDraft { expectedRevision, operations? }`. When the session has a
  draft, the revision is required (a resumed older client cannot silently drop recorded
  evidence). Inside the finalization transaction the final operations apply, the active
  entries merge with unmatched legacy report arrays by canonical kind and content, the
  merged set is validated without truncation, and the draft is sealed and linked to the
  delivery with each entry's deterministic V1 reference. A failed delivery leaves the draft
  open; a replayed delivery returns the original sealed result. Database triggers make
  sealed drafts, their entries and batch receipts immutable.
- Drafts never create `mission_items`, obligations, badges, seen-state changes or lifecycle
  meaning; only the accepted delivery report does. `record-work` stays sessionless and
  rejects `reportDraft`.
- Add the read-only operator projection `GET /api/objectives/{id}/report-drafts`
  (`mission:read`) and `delivery_report_draft` entity changes for scoped refresh. No human
  editing surface.
- Retry identity follows ADR 0075: the batch `operationId` is caller-retained inside the
  batch itself; neither the CLI nor an MCP handler mints one.

## Consequences

Additive minor change. Clients that never send `reportDraft` see no behavior change and
need no extra call. Agent guidance for drafts ships as an opt-in pilot before becoming a
default instruction. Web, desktop and iOS show the projection in later objectives. The
migration `20261118160000_delivery_report_drafts` adds the tables in both editions and
changes no existing data; rolling back application code leaves the tables unused.
