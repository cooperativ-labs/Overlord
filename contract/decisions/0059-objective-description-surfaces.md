# ADR 0059: Objective descriptions on the REST, protocol, MCP and connector surfaces

- Date: 2026-11-14
- Status: accepted
- Contract version: 172.3.0
- Supersedes: none (builds on ADR 0057 and ADR 0058)

## Context

ADR 0057 gave objectives a human-facing description with durable ownership, removal
suppression and generation state; ADR 0058 added the worker that writes generated titles and
summaries. Neither exposed anything on a wire: people could not read or edit a summary, agents
could not write one, and nothing could ask for Summarize, Regenerate or Retry (mission coo:1275,
plan `planning/feature-plans/objective-descriptions-ste.md` §4.8, review findings 4 and 7).

The product rules are settled. People edit descriptions in any state, including after launch and
completion. Agents and assistants qualify for automatic summaries with or without an attached
session. Remove keeps a summary absent until a person explicitly selects Summarize. Descriptions
are presentation: the executing agent receives the instructions only.

## Decision

1. **One projection for people.** `ObjectiveDto` carries the brief state as required, additive
   fields: `titleSource`, `titleStatus`, `description`, `descriptionSource`, `descriptionStale`,
   `descriptionStatus`, `descriptionFailureCode` (stable codes only), `descriptionSuppressed`,
   `descriptionEligible`, `descriptionRevision`, `descriptionUpdatedAt`,
   `descriptionAuthorWorkspaceUserId` and `descriptionAuthorAgent`. Every read that returns an
   `ObjectiveDto` (mission detail, objective create/update, protocol `update-objective`, MCP
   `overlord_update_objective`) is already authorized for the objective. The activity feed adds a
   presentation-only `descriptionPreview` of the primary objective. Old clients ignore the
   fields.
2. **Execution contexts stay instruction-only.** `ObjectiveSummary` (attach, load-context,
   `previousObjectives`/`futureObjectives`, create and add-objectives results) and the launch
   prompt never carry the description. Tests pin this.
3. **Authored descriptions on every create and edit route.** REST `POST /api/missions` items,
   `POST /api/objectives` and `PATCH /api/objectives/{id}` take `description` with the ADR 0057
   mutation table (omitted unchanged, `null`/blank Remove, text authored); `PATCH` also takes
   `expectedDescriptionRevision` (409 `description_conflict` with the current revision and text).
   Protocol `create`/`prompt` take `--objective-description` / `--objective-description-file`
   for the single `--objective` form and a per-item `description` in `--objectives-json`;
   `add-objectives` takes the per-item field; `update-objective` takes `--description` /
   `--description-file` (empty text is Remove). Hosted MCP and the connector shim forward
   `description` on `overlord_create_mission`, `overlord_add_objectives` items and
   `overlord_update_objective`.
4. **Explicit presentation operations.** REST `POST /api/objectives/{id}/description-requests`
   with `{ mode: summarize | regenerate | retry }`, and protocol
   `update-objective --description-request` / MCP `descriptionRequest`, record durable intent and
   enqueue the brief job in one transaction. They never wait for a model and never change
   instructions, lifecycle, Run Queue membership or evidence. Stable 409 codes:
   `description_not_eligible`, `description_not_failed`, `description_suppressed`,
   `description_conflict`, `objective_conflict`; 400 `description_too_long`.
5. **People versus agents.** REST callers are people: they edit, remove and request summaries in
   every objective state, and only their Summarize or Regenerate clears removal suppression.
   Protocol and hosted-MCP callers are agents, with or without a session: description writes and
   summary requests are allowed only on `draft` objectives (400 `description_not_editable`),
   the same planning scope as protocol instruction edits, which stay draft-only. While a person's
   removal is in force, agent text is not stored (a `description_suppressed` warning, so batches
   are not rejected) and agent Summarize/Regenerate is refused; agent Retry re-requests only a
   failed generation and never clears suppression. Agent title edits keep their any-state rule.
6. **Advisory warnings, never rejection.** Protocol and MCP responses return structured
   `warnings` (`code`, `message`, optional `rule`, `excerpt`, `suggestion`): `description_style`
   for heuristic Simplified Technical English issues in authored text (at most ten per text) and
   `description_suppressed`. On `create`/`add-objectives` they sit on the matching created
   objective; on `update-objective` they are a top-level array. Text is stored as written.
7. **Presentation-only events.** A description-only edit or request moves `revision` and appends
   one `entity_changes` row (changed field `description`) so clients refresh; it never moves
   `updated_at`, raises a notification, or triggers a mission-summary job. Generation completion
   is the same (ADR 0058).
8. **Parity.** CLI help, OpenAPI, protocol-commands.yaml, the generated MCP catalog, docs and the
   connector skill describe the same operations. `--instruction-text-file`, `--description-file`
   and `--objective-description-file` join the CLI's file-input flags (the first was previously
   accepted by the backend but never read by the CLI).

## Consequences

- Clients can render summary, instructions, provenance, pending/failure/stale states and the
  Summarize/Regenerate/Remove controls from one DTO without new reads.
- An agent cannot restore a summary a person removed, by text, request or retry.
- Old servers omit the fields; clients must treat them as optional when talking to older
  backends. Old clients that send no `description` keep today's behavior.
- The feed card can show a summary without loading the mission.

## Alternatives considered

- **Separate `PUT /description` route.** A second write path for one field; `PATCH` already has the
  transaction, permission and change-feed handling. Rejected; `PATCH` takes `description` and a
  description-only `PATCH` keeps `updated_at`.
- **Agent description edits in any state, like titles.** Wider than the existing editable planning
  scope that the review recommended (finding 4). Rejected for the first release.
- **Return warnings by rejecting non-STE text.** The linter is heuristic; rejecting would block
  valid writes. Rejected: warnings only.
- **Put `description` on `ObjectiveSummary`.** That shape is the agent's execution context.
  Rejected (plan §4.11).
