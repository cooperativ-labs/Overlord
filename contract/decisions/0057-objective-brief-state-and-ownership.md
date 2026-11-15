# ADR 0057: Objective brief state, presentation ownership and removal suppression

- Date: 2026-11-14
- Status: accepted
- Contract version: 172.1.0
- Supersedes: none

## Context

Agents write long, exhaustive objective instructions. People who decide whether to launch,
reorder or reject an objective need a short summary next to them (mission coo:1275; plan
`planning/feature-plans/objective-descriptions-ste.md`). Before this decision an objective had one
presentation field, `title`, written by a fire-and-forget model call. Review of that path and of
the plan found that the persistence model could not support summaries safely:

- titles had no provenance, so an instruction edit could replace a title a person or agent wrote,
  and `createMission` scheduled a generated title for the first objective even when the caller
  supplied one;
- a generated result carried no token, so a late result could overwrite a newer edit;
- `created_by_*` describes who created the row, not who wrote the current instructions, so a
  later scan could not tell whether an edited objective qualifies for an automatic summary;
- there was no durable way to say "a summary is wanted", "generation failed", or "the person
  removed the summary; keep it removed".

The product decisions are settled: summaries are written automatically only for instructions
written by an agent or assistant (attached session or not); people can edit summaries in any state,
including after launch and completion; Remove keeps the summary absent until a person explicitly
selects Summarize, across edits, catch-up and in-flight results; titles and summaries have
independent ownership.

## Decision

1. **Columns.** `objectives` gains, in both dialects, `title_source`, `title_generation`,
   `title_status`, `description`, `description_source`, `description_instruction_hash`,
   `description_author_workspace_user_id`, `description_author_agent`, `description_updated_at`,
   `description_revision`, `description_suppressed`, `description_generation`,
   `description_status`, `description_request_kind`, `description_failure_code` and
   `instruction_author_kind` (data/README.md "Objective brief state"). All are nullable or
   defaulted; the migration is additive.
2. **Independent ownership.** `title_source` and `description_source` take `generated`, `agent` or
   `user`. Only `generated` text may be replaced by automation. A null `title_source` means the
   provenance is not known; it is treated as owned, so no legacy title is replaced automatically.
   Each field has its own generation counter, so a description request never invalidates or
   overwrites a title and vice versa.
3. **Current-instruction authorship.** `instruction_author_kind` records the class of the actor
   that wrote the current instruction text and follows every edit. Protocol and hosted-MCP writes
   (including `update-objective`, which previously reached the REST implementation without an
   origin) and in-app assistant writes are `agent`; REST writes are `human`. The migration
   backfills it from `created_by_kind` only where the change feed proves the instructions were
   never edited; everything else stays unknown and never qualifies for an automatic summary.
4. **Durable intent and stale-write protection.** A wanted summary is persisted as
   `description_status = 'pending'` with a request kind. Every instruction change, authored edit,
   removal and new request increments `description_generation`; a generated result publishes only
   if the generation and the trimmed-instruction hash still equal what the generator read and the
   row is live and not suppressed. Because the intent lives on the row rather than in a job
   payload, an edit made while a job runs leaves the newest generation pending for the worker to
   pick up; a deduplicated job can no longer lose a request. Position changes, launch and reopen
   do not invalidate a result.
5. **Mutation semantics.** For an authored `description` value: omitted leaves it alone; `null`
   or blank text is Remove; other text is stored with source `user` or `agent` and the editor's
   attribution. Remove sets `description_suppressed` and cancels outstanding requests. Only a
   person's Summarize or Regenerate clears suppression; agent requests while suppressed are refused
   (`description_suppressed`, 409) and agent text is not stored (a `description_suppressed`
   warning, so batch writes are not rejected). Retry re-requests only a failed generation.
   Description edits use `description_revision` for optimistic concurrency
   (`description_conflict`, 409).
6. **Presentation-only writes.** Description edits are allowed in every state. They do not touch
   instructions, lifecycle state or timestamps, Run Queue membership, execution evidence or
   `updated_at` (which orders the activity feed); they bump `revision` and append one change-feed
   row. Instruction-edit restrictions (protocol draft-only, REST locked after execution begins)
   are unchanged.
7. **One implementation.** The rules live in `packages/core/service/objective-brief.ts` as pure
   planners plus transactional service operations (set/remove description; summarize, regenerate
   and retry requests; worker-facing publish and fail; bounded catch-up selection). Object
   creation and the REST/protocol update path apply the same planners in their own transactions.
8. **Scope of this change.** No REST, protocol or MCP field exposes these columns yet, no worker
   job kind is registered and no model is called for descriptions. Pending intent is recorded for
   the brief worker; the existing title call is kept and now publishes only through the ownership
   and generation guard.

## Consequences

- An authored title (agent or person) is never overwritten by title generation, including the
  first objective of a new mission and a title set while a generation was in flight.
- Legacy objectives keep their titles even when their instructions are edited; a person can clear
  the title to hand it back to automation.
- Agent-written open objectives created after the migration carry pending summary intent until the
  brief worker ships; nothing renders it, and launch never waits on it.
- Release with matching client and worker slices; old clients ignore the columns because no DTO
  carries them yet.

## Alternatives considered

- **A side table `objective_briefs`.** Keeps `objectives` narrower but needs a join on every list
  and DTO read and a second row lifecycle for soft delete. Rejected; the plan places presentation
  fields on the objective.
- **Deduplicate jobs by objective id only.** Loses an edit made while a job runs. Rejected in favour
  of persisted generation intent.
- **Treat unknown legacy titles as generated.** Restores today's regenerate-on-edit for old rows but
  silently replaces titles people wrote. Rejected as the review recommended.
- **Reset to automatic after Remove.** Simpler state, but the removed summary could reappear
  immediately. Rejected by the settled product rule.
