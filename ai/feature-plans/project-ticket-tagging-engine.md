# Project Ticket Tagging Engine Plan

## Objective

Add project-scoped ticket tags with a local-only automatic tagging engine that proposes and maintains tags from ticket text and repo operations metadata, while preserving direct user control over tag names and ticket assignments.

## Product Requirements

- Every project has its own tag catalog.
- Users can rename tag labels per project without changing the engine's internal mapping.
- Users can add or remove tags on any ticket directly.
- The engine can auto-apply tags from:
  - the ticket description and title
  - explicit file paths mentioned in the prompt
  - the project's repo operations profile
  - later execution evidence such as changed file paths and commands run
- The engine must not overwrite a user's direct tag decisions.
- The implementation must not send repository code or diffs to an external LLM or server.
- Tagging logic should live in its own reusable module so it can be debugged and adopted by other projects.

## Recommended Model

Use a split model with:

1. Project tag definitions
2. Ticket tag assignments
3. Engine suppression state for user overrides
4. A standalone tagging engine module that only consumes metadata

This keeps display concerns separate from engine reasoning and gives the engine a safe way to avoid fighting the user.

## Data Model

### `project_tag_definitions`

Project-scoped tag catalog with stable engine-facing keys and editable user-facing labels.

- `id uuid primary key`
- `project_id uuid not null references public.projects(id) on delete cascade`
- `key text not null`
- `label text not null`
- `description text null`
- `color text null`
- `is_active boolean not null default true`
- `created_at timestamptz not null default timezone('utc', now())`
- `updated_at timestamptz not null default timezone('utc', now())`
- unique `(project_id, key)`
- unique `(project_id, label)` after case-normalization if you want to prevent duplicate visible labels

Notes:

- `key` is the canonical identity the engine targets, for example `webapp`, `desktop`, `mobile-app`, `edge`, `database`.
- `label` is editable by the user, for example `Web`, `Desktop App`, or `Backend Edge`.
- `key` should remain stable even when `label` changes.

### `ticket_tag_assignments`

Current tag state for a ticket.

- `ticket_id uuid not null references public.tickets(id) on delete cascade`
- `tag_definition_id uuid not null references public.project_tag_definitions(id) on delete cascade`
- `source text not null`
- `applied_by uuid null references auth.users(id) on delete set null`
- `applied_at timestamptz not null default timezone('utc', now())`
- `updated_at timestamptz not null default timezone('utc', now())`
- primary key `(ticket_id, tag_definition_id, source)`

Recommended `source` enum values:

- `user`
- `engine`

Allow both a user row and an engine row for the same ticket/tag pair. The effective UI state is the union of active rows. This makes provenance explicit and prevents the engine from trampling a user's assignment.

### `ticket_tag_engine_suppressions`

Explicit memory that a user rejected an engine-applied tag.

- `ticket_id uuid not null references public.tickets(id) on delete cascade`
- `tag_definition_id uuid not null references public.project_tag_definitions(id) on delete cascade`
- `suppressed_by uuid null references auth.users(id) on delete set null`
- `reason text not null default 'user_removed_engine_tag'`
- `created_at timestamptz not null default timezone('utc', now())`
- `updated_at timestamptz not null default timezone('utc', now())`
- primary key `(ticket_id, tag_definition_id)`

This table is the key guardrail. If a user removes an engine tag, the engine records a suppression instead of re-applying it on the next pass.

### Optional `ticket_tag_events`

If you want auditability beyond current state, add an append-only event log later. It is not required for the first delivery if current-state tables already capture enough provenance.

## Effective Tag Semantics

For each ticket and tag definition:

- visible on the ticket if either a `user` assignment or an `engine` assignment exists
- removable by the user from the UI
- if the user removes a tag that only the engine applied:
  - delete the `engine` assignment
  - insert or upsert a suppression row
- if the user adds a tag directly:
  - create a `user` assignment
  - optionally remove a suppression for the same tag, since the user has now explicitly re-enabled it

Engine rule:

- the engine may only create or delete `source = 'engine'` assignments
- it may never delete `source = 'user'` assignments
- it must check suppressions before adding an engine assignment

This guarantees that user intent wins.

## Engine Architecture

Create a dedicated module at `lib/tagging-engine/`.

Recommended structure:

- `lib/tagging-engine/types.ts`
- `lib/tagging-engine/constants.ts`
- `lib/tagging-engine/project-tags.ts`
- `lib/tagging-engine/sources/description.ts`
- `lib/tagging-engine/sources/repo-profile.ts`
- `lib/tagging-engine/sources/execution-evidence.ts`
- `lib/tagging-engine/scoring.ts`
- `lib/tagging-engine/reconcile.ts`
- `lib/tagging-engine/apply.ts`
- `lib/tagging-engine/debug.ts`

### Responsibilities

`project-tags.ts`

- load project tag definitions
- ensure default definitions exist for a project
- map stable `key` values to editable display labels

`sources/description.ts`

- parse title, objective, acceptance criteria, and explicit file paths in ticket text
- emit evidence objects such as `path_match`, `keyword_match`, `path_prefix_match`

`sources/repo-profile.ts`

- read the project's stored operations profile and derive tag evidence from deployables, workspaces, migration directories, and known scripts

`sources/execution-evidence.ts`

- derive evidence from observed file changes, change rationales, artifacts, and relevant commands
- intended for later reclassification or confidence boosting

`scoring.ts`

- convert evidence into candidate tag scores
- return a debug payload with evidence lines per tag

`reconcile.ts`

- compare engine candidates with current assignments and suppressions
- compute the exact `engine` rows to insert or delete

`apply.ts`

- commit the reconciliation result inside a transaction

`debug.ts`

- format a human-readable explanation of why a tag was or was not applied

## Initial Tagging Inputs

The first version should stay deterministic and local-only.

### Ticket text signals

- title
- objective / description
- acceptance criteria
- explicit path mentions

### Repo operations profile signals

From the current project profile:

- workspaces
- deployables
- deploy targets
- migrations metadata
- scripts by workspace

### Execution evidence signals

For later passes or a follow-up ticket:

- changed file paths
- recorded file changes
- commands run during the ticket
- test/build commands used

No source code contents are needed. Only metadata and paths are inspected.

## Overlord Default Taxonomy

For the Overlord repo, seed these canonical project tag keys:

- `webapp`
- `desktop`
- `mobile-app`
- `edge`
- `database`

Default labels can match the current wording:

- `webapp` -> `webapp`
- `desktop` -> `desktop`
- `mobile-app` -> `mobile app`
- `edge` -> `edge`
- `database` -> `database`

Later projects can define their own keys and labels using the same engine.

## Suggested Classification Rules For Overlord

### Path rules

- `apps/web/**` -> `webapp`
- `apps/desktop/**` -> `desktop`
- `apps/mobile/**` -> `mobile-app`
- `supabase/functions/**` -> `edge`
- `supabase/migrations/**`, `supabase/seed.sql`, `seed.ts`, `types/database.types.ts` -> `database`

### Keyword rules

- `webapp`: `next.js`, `nextjs`, `app router`, `component`, `browser`, `vercel`
- `desktop`: `electron`, `desktop`, `ipc`, `preload`, `packaged app`
- `mobile-app`: `expo`, `react native`, `ios`, `android`, `device build`
- `edge`: `edge function`, `supabase function`, `webhook`, `deno`
- `database`: `migration`, `schema`, `rls`, `sql`, `table`, `seed`, `types`

### Repo profile rules

Use the stored profile to add non-text evidence:

- workspace/deployable at `apps/web` -> `webapp`
- workspace/deployable at `apps/desktop` -> `desktop`
- workspace/deployable at `apps/mobile` -> `mobile-app`
- functions or deploy target `supabase` in `supabase/functions` -> `edge`
- migrations block with Supabase migrations -> `database`

### Scoring policy

Recommended first-pass weights:

- explicit path match: `+100`
- exact workspace/deployable match: `+50`
- strong keyword hit: `+25`
- supporting repo-profile signal: `+15`
- contradictory signal: `-20`

Application policy:

- apply one or more tags above a minimum threshold
- allow multiple tags when scores are independently high
- return debug evidence with every engine decision

## Lifecycle

### On ticket creation

- run the engine from ticket draft metadata
- create `engine` assignments for matching tags

### On ticket edit

- re-run the engine when title/objective/acceptance criteria change
- only mutate `engine` rows
- keep user rows untouched
- keep suppressed tags suppressed

### On user tag changes

- adding a tag creates a `user` assignment
- removing a tag removes the `user` row if it exists
- if the tag was engine-applied, remove the engine row and create a suppression

### On execution updates

- optional second pass after file changes or commands appear
- may add additional `engine` rows if new evidence appears
- must still respect suppressions and never touch user rows

## UI Plan

### Project settings

Add a project-level tag management surface in the existing project settings area.

Capabilities:

- list project tag definitions
- rename tag labels
- create a new tag definition
- archive or deactivate a tag definition
- show stable internal key in a secondary admin view if needed

Recommended placement:

- extend the project settings modal/sheet with a `Tags` section

### Ticket surfaces

Add tag chips to ticket list cards and ticket detail surfaces.

Capabilities:

- render effective tags from the merged `user` + `engine` state
- add a tag from the project's tag catalog
- remove a tag directly
- optionally distinguish engine-applied tags visually on hover or in a debug panel, but do not force that distinction into the default UI

### Debug surface

Add an internal debug view for a ticket's engine reasoning.

Show:

- evidence lines
- scores by tag
- current suppressions
- which assignments are `user` vs `engine`

This is important for trust and future reuse.

## Server Actions And API Shape

Recommended actions:

- `ensureProjectTagDefinitionsAction(projectId)`
- `listProjectTagDefinitionsAction(projectId)`
- `createProjectTagDefinitionAction(projectId, input)`
- `updateProjectTagDefinitionAction(projectId, tagId, input)`
- `applyUserTagToTicketAction(ticketId, tagId)`
- `removeUserTagFromTicketAction(ticketId, tagId)`
- `runTicketTaggingEngineAction(ticketId, reason)`

Keep orchestration thin in actions and put the actual decision logic in `lib/tagging-engine/`.

## RLS Plan

### Read

- org members can read tag definitions for projects they can access
- org members can read ticket tag assignments for tickets they can access

### Write

- managers/admins can manage project tag definitions
- authenticated org members who can edit tickets can add or remove tags on those tickets
- engine write path should run through trusted server actions or backend handlers that enforce source ownership rules

## Rollout Plan

### Phase 1

- add storage model and types
- seed default Overlord project tag definitions
- add minimal ticket tag read/write support

### Phase 2

- implement `lib/tagging-engine/` with deterministic description + repo-profile scoring
- auto-apply tags on ticket create and ticket edit
- add suppression handling

### Phase 3

- add project settings UI for tag management
- add ticket UI for add/remove/edit flows
- add engine debug view

### Phase 4

- add execution-evidence enrichment from changed files and commands
- decide whether the engine should re-run automatically at review/deliver transitions

## Acceptance Criteria

- A project can define and rename its own ticket tags.
- New Overlord tickets can be auto-tagged from prompt metadata without inspecting code contents.
- Users can add or remove tags directly on tickets.
- Engine updates never remove a user-applied tag.
- If a user removes an engine-applied tag, the engine does not immediately re-add it.
- Tagging logic lives primarily under `lib/tagging-engine/` and is reusable outside the Overlord repo taxonomy.
- A debug surface or structured debug output exists so engine decisions are inspectable.

## Open Decisions

- Whether tag creation should be limited to managers/admins or allowed to any project member with edit rights.
- Whether project tags need colors in the first release or can remain text-only.
- Whether ticket creation should block on tag seeding when a project has no tag definitions yet, or lazily seed on first access.
- Whether execution-evidence retagging should be automatic or manual in the first iteration.

## Recommended Ticket Breakdown

1. Database and type support for project tag definitions, ticket assignments, and suppressions.
2. Shared tagging engine module with deterministic scoring from ticket text and repo profile metadata.
3. Ticket create/edit integration plus user-safe reconciliation rules.
4. Project settings UI and ticket tag editing UI.
5. Debug tooling and optional execution-evidence enrichment.
