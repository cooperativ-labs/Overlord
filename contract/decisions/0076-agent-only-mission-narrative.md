# ADR 0076: Agent-only mission narrative and post-delivery publication

Status: accepted
Date: 2026-11-18

Amends ADR 0046 (operator mission summary), ADR 0060 (agent-authored summary),
ADR 0073 (finalization boundary consumers) and ADR 0075 (finalization receipts).
Retires the automatic mission summary composer and its worker job type.

## Context

The mission headline and summary had two writers: the delivering agent (ADR 0060) and a
background composer (Gemini, with a deterministic fallback) triggered by deliveries,
item decisions, questions and reopens. Inline agent prose was guarded only by
`content_revision`, so a stale base rejected the whole delivery, including its valid item
closes, and a prose-free parallel delivery could leave the content revision unchanged
while changing what the prose had to cover (review finding R1). Any live agent prose
blocked the fallback even after newer prose-free deliveries, and fallback publication
moved the same concurrency token. The product decision for coo:1297 is: no automatic
mission headline or summary generation at all, no publication timer, no partial
delivery, and no editable accepted reports.

## Decision

- **Agent-only.** Only an agent with execution context writes mission headline and
  summary. The composer worker, its automation, its exports, every enqueue path
  (presentation persistence, item resolution and restore, question/choice lifecycle,
  objective reopen) and the deterministic narrative synthesis are removed. Delivery
  report formatting (`overlord.delivery.compose.v1`) is a separate path and stays.
- **Evidence basis.** `mission_summaries.evidence_revision` advances under the mission
  lock on every accepted delivery and record-work, explicit follow-up, objective reopen
  and source-delivery deletion. Item decisions, questions, progress and presentation
  rewrites do not move it. `published_evidence_revision`, `narrative_published_at` and
  `narrative_changed_at` record what the prose covers and when it changed.
- **Accepted stale prose (R1).** Inline prose publishes only when both
  `baseContentRevision` and the new `baseEvidenceRevision` match the pre-delivery state.
  Stale content or evidence, a missing evidence base (older clients) or no prose never
  rejects the delivery: closes and all other work are accepted and the prose is withheld.
  Record-work keeps its new-mission exception. 409 `mission_summary_conflict` no longer
  answers `deliver`.
- **Publication opportunity.** Every accepted delivery of an eligible mission creates one
  `delivery_summary_publications` row, referenced from the acceptance receipt, holding
  the immutable original proposal and, once published, the immutable published text. A
  newer basis supersedes outstanding rows; a fulfilled row is never superseded.
- **Narrow publication.** `delivery-summary-context` and `publish-delivery-summary`
  (MCP `overlord_delivery_summary_context`, `overlord_publish_delivery_summary`) read and
  fulfil one opportunity. Authority is the current authenticated member who originated the
  delivery, with project scope and `event:create`, plus the original session key for a
  session-bound opportunity; the delivered, ended session is accepted for these two
  commands only. Record-work opportunities are sessionless and bound to their member. One
  successful publication, a required caller-retained operation id, idempotent replay,
  CAS on both bases (409 `mission_summary_conflict`), 409
  `mission_summary_publication_superseded` and `mission_summary_already_published`, and
  404 `mission_summary_publication_not_found` without existence leaks.
- **No timer.** No deadline column, expiry job, waiting timer or automatic repair.
  Validity follows the basis and authorization, not elapsed time.
- **Freshness and seen.** Summary reads, attach baselines and publication context carry a
  server-derived `narrative` envelope (`absent`, `current`, `outdated`, `legacy`) and the
  read carries `narrativeWatermark`. The seen marker stays one scalar; clients acknowledge
  the combined maximum only after every evidence group of the response was rendered
  (review finding R2). The seen upper bound includes the retained `narrative_changed_at`.
- **Historical data.** Existing prose and provenance stay in place and read as `legacy`;
  nothing is regenerated, relabelled or backfilled with fabricated coverage. Pending rows
  become `composed`; queued and running composer jobs are cancelled with their audit
  rows kept. `generated_by` and `status` keep their historical vocabularies.

## Cutover gate

No old automatic writer may run against the new schema. Migration
`20261118140000_agent_only_mission_narrative` installs a database-enforced agent-only
fence in both editions: triggers drop composer job inserts and revivals, `pending`
status writes and non-agent headline/summary writes without failing the statement, and
clear the coverage basis of agent prose written without a new publication timestamp.
With the fence the migration may run while an old replica still serves requests: its
deliveries commit, and its automatic narrative writes are dropped.

The release sequence remains conservative: stop or drain the old backend replicas
(Cloud), or stop the old Local server, before the migration and new activation where the
deploy wrapper supports it; verify no old composer holds a running lease (the migration
cancels any) and that no `overlord.mission.summary.compose.v1` job is queued afterwards.
Local upgrades run the migration at startup of the new version in a single process.
Rolling back application code reintroduces no writer while the fence stays installed;
rolling back the migration is not supported without a reviewed compatible build.

Rehearsal and verification (run against a restored copy first, then production, in both
editions):

1. Before: `SELECT status, count(*) FROM worker_jobs WHERE type =
   'overlord.mission.summary.compose.v1' GROUP BY status;` records the queued/running
   backlog to be cancelled.
2. Stop or drain old replicas where supported; apply the migration; start the new build.
3. After: the same query shows no `queued` or `running` rows; `SELECT count(*) FROM
   mission_summaries WHERE status = 'pending';` is 0.
4. Fence check inside a rolled-back transaction: inserting a queued compose job leaves no
   row, and updating a summary's headline with `generated_by = 'gemini'` leaves it
   unchanged.
5. A delivery without prose returns `missionSummary.publication.available: true` and
   enqueues no compose job.

## Consequences

- A stale narrative can no longer reject accepted work or discard valid item decisions.
- Missions whose agents omit prose show missing or outdated prose honestly, alongside
  live items and status; nothing fills it in.
- Older clients still deliver; their prose is withheld when they omit the evidence base,
  and they can leave prose absent or outdated indefinitely.
- Web, desktop and iOS adopt the freshness envelope and the rendered-coverage seen rule in
  their own objectives; the backend change ships with them as one user-facing release.
