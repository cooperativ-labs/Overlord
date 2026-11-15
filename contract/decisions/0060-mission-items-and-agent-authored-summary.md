# ADR 0060: Mission items hold live risks, human actions and suggestions; agents may edit the mission summary

- Date: 2026-11-15
- Status: accepted
- Contract version: 173.0.0
- Supersedes: none
- Amends: [ADR 0046](0046-operator-only-mission-summary.md) (the rule that the summary is never sent to agents)

## Context

The mission summary panel goes stale. Its headline and summary are written by an external model
that sees bounded delivery prose and no repository state. Its lists come from three places that
nothing keeps in step: risks are references the model selected into
`mission_summaries.risks_json`; human actions are a read-time projection of delivery JSON with no
status since contract v150; suggestions are deferred work in delivery JSON minus
`human_action_resolutions` rows. An item leaves the panel only when its own objective re-delivers
or reopens, so work done later by another objective never retires it. Risk and human-action ids in
delivery JSON are positional, so nothing can address one of them across reads.

Mission coo:1260 (plan `planning/feature-plans/agent-authored-mission-summary.md`) addresses
this. ADR 0046 made the summary an operator-only surface: "never sent to agents ... now or later". The
delivering agent is the only participant that has seen the repository, so it is the participant
that can tell which earlier claims are still true.

## Decision

1. **One table for live items.** `mission_items` holds one row per risk, human action or
   suggestion a delivery reported, with a closed `kind` (`risk`, `human_action`, `suggestion`) and
   a closed `status` (`open`, `done`, `dismissed`, `superseded`). One table, not one per kind: the
   three share a lifecycle, the same reads and the same writes, and differ only in content fields,
   which live in `detail_json`. The delivery report stays the immutable record of what the agent
   reported; the table is the live working set. This reverses the v166 rule that item text is never
   copied out of a delivery.
2. **Stable identity.** `item_ref` identifies an item inside its delivery and is unique on
   `(delivery_id, kind, item_ref)`. A suggestion reuses `DeferredWorkV1.id`. A risk uses a digest of
   its normalised text. A human action uses a digest of its provenance (source, delivery-local id,
   `sourceRef`) and the agent's own wording, which the delivery composer preserves when it
   rephrases an action. Clients and agents address an item by its row `id`.
3. **One writer, one reader.** The core item service owns every write: insert at delivery,
   reconcile when the composed or fallback presentation is saved (update matched rows, insert new
   ones, delete rows that are still `open` and no longer listed), close, restore, and supersede.
   `listMissionItems` is the single definition of "open" for the summary route, the attach
   baseline, the delivery DTO and the fallback composer. Every write appends an `entity_changes`
   row with `entity_type = 'mission_item'`. Row derivation, the insert statement and the supersede
   predicates live in `@overlord/database` so the migration backfill and the live path produce the
   same rows. The strict persisted delivery-report reader moves to
   `@overlord/contract/delivery-report` for the same reason.
4. **The current-run rule becomes a stored status.** When a newer live delivery of an objective
   exists, the `open` human actions of its earlier deliveries become `superseded` (the v136 rule).
   When an objective reopens, every `open` item reported before its `reopened_at` becomes
   `superseded`. Only `open` rows are superseded, so a person's or agent's decision is never lost.
   An agent cannot close a `superseded` item, and nobody can restore one. A person may still
   decide one from the delivery card of a delivery made before its objective reopened, as the
   card has always allowed; restoring that decision re-applies these rules, so the item returns to
   `superseded` and never back to the open lists.
5. **Decisions on the row.** A person or an agent closes an item as `done` or `dismissed`; the row
   records who (`resolved_by_kind` `person` or `agent`, with the workspace user, or the closing
   objective and delivery), when, and a reason of at most 280 characters, required for an agent.
   Promotion of a suggestion is `done` with an `outcome`, as before. A person may restore a closed
   item, which reopens it unless the supersede rules apply. `mission_items` replaces
   `human_action_resolutions`.
6. **Agent-authored narrative.** This amends ADR 0046 where it says the summary is never sent to
   agents. Agents receive the summary as an editing baseline at attach and may write the headline,
   the summary and item status at delivery, under optimistic concurrency on a new
   `mission_summaries.content_revision` that moves only when the narrative is written.
   `mission_summaries.generated_by` gains `agent`; `narrative_delivery_id` and
   `narrative_objective_id` record which delivery wrote the current narrative. The seen marker
   stays operator-only, and ADR 0046's eligibility rule (`missions.summary_enabled`) is unchanged.
7. **One-way migration in one release.** Migration `20261115120000_mission_items` creates the
   table and columns in both editions. Its TypeScript runtime step backfills rows from every live
   delivery, copies each `human_action_resolutions` row onto its suggestion row, then applies the
   supersede rules; it is batched and idempotent. A later migration of the same release drops
   `human_action_resolutions`, `mission_summaries.risks_json` and `suggestions_json`. No legacy read
   path or dual write is kept.

## Consequences

- Risks, human actions and suggestions can be retired by whoever verified them, and the panel, the
  delivery cards and the agent's baseline read the same rows.
- Risks become a deterministic list of open rows; the summary model no longer selects them.
- Human actions regain a status, reversing the v150 "shown, never ticked off" rule: people may
  close and restore risks and human actions.
- A delivery's items are written twice (report and table). The single writer, the reconcile step
  and a comparison test against the JSON-derived lists keep them in step.
- The contract increment is major: a closed vocabulary gains a value, data meaning changes, a
  table is replaced, and an ADR guarantee is reversed.
- Rolling back after the drop migration needs a database restore.

## Alternatives considered

- **Keep `human_action_resolutions` and add a retirement table.** Rejected: three stores of item
  state that the panel, the cards and the agent baseline must merge identically.
- **One table per kind.** Rejected: identical lifecycle and reads; three tables triple every
  query and write path.
- **A database view over delivery JSON.** Rejected: neither edition has views, JSON functions
  differ between SQLite and Postgres, and a view cannot hold status.
- **Backfill in SQL.** Rejected: item references are digests computed in code, and the stored
  report must be read with the same strict schema the read surfaces use.
- **Keep the external model as the author with more evidence.** Rejected: more history cannot
  reveal a fix absent from the input; the model stays only as a fallback for deliveries that carry
  no agent summary.
