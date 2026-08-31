# coo:882 — Refine Objectives with an AI Agent ("Improve with AI")

**Status:** SUPERSEDED (2026-08-31) — after PM discussion, refinement is now a
standalone product (working name Refinery) outside Overlord; see
`coo-882-refinery-standalone-product.md` in the Refinery repo
(`~/Development/Cooperativ/Refinery/planning/`) and
`coo-882-overlord-refinery-integration.md` here. The accept/edit UX, grounding-skill
staging, and proposal-schema thinking below carry forward; the in-Overlord
mechanism (objective_refinements table, requested_source='refinement', runner
headless launch, propose-refinement protocol verb) does not. Kept for the
rejected-alternatives analysis.
**Mission:** `coo:882` — Refine Objectives with AI Agent
**Contract impact:** version bump required before implementation (new table, protocol commands, REST endpoints, MCP tools, runner behavior).
**Modules touched:** `database`, `protocol` (packages/core service layer), `rest`, `runner`, `cli`, `connector`, `mcp`, `webapp`. `automations` is deliberately untouched in v1.

---

## 1. Problem and use case

Work frequently enters Overlord as forwarded user feedback — a Slack message, an
email, a sentence typed on a phone. The Slack intake design (coo:880) makes that
capture fast on purpose, which means the resulting mission/objective text is
usually **vague and under-specified**: it names a symptom or a wish, not the
repository reality an executing agent needs.

Today the PM must manually translate that text into a precise objective, or an
executing agent burns a session rediscovering context and guessing at scope.

**The feature:** a PM can ask Overlord to *refine* an objective. Overlord sends
the original text to a coding agent that runs **against the project's actual
repository**, and the agent responds with a structured proposal: clearer,
codebase-accurate objective text plus rationale, assumptions, open questions,
and code references. The PM reviews the proposal in Overlord and **accepts**
(optionally after editing), **rejects**, or re-runs with guidance. Acceptance
rewrites the objective; nothing is ever applied silently.

This plan defines the underlying "improve with AI" machinery: (a) the mechanism
that gets the original text to a repo-aware agent and the proposal back, and
(b) the accept/reject lifecycle. Interactive multi-round conversation with the
PM is supported through bounded rounds, not a live chat surface (see §6).

## 2. Product decisions

1. **Refinement is a proposal, never an edit.** The agent cannot change an
   objective. It produces an immutable proposal record; only an authorized
   human (or an explicitly invoked agent tool acting for one) applies it.
2. **The agent reads the real repository.** Refinement runs where the code
   lives — on an execution target with the project checkout — using the same
   claim/launch infrastructure as normal objective execution. A server-side
   LM call without repo access is explicitly *not* the v1 mechanism (§5.1).
3. **Refinement never touches objective lifecycle state.** The objective stays
   `draft`/`future` throughout. Refinement state lives on its own record.
4. **Refinement is read-only with respect to the worktree.** The refine agent
   must not modify, stage, or commit files. v1 enforces this by prompt contract
   and by ignoring any ledger evidence from refinement sessions; a hard
   sandbox is a known limitation (§10).
5. **Rounds, not chat.** Each request → proposal → resolve cycle is one round.
   Rejecting with guidance (or answering the proposal's questions) starts the
   next round with full prior-round context. This composes with the existing
   draft-objective discussion flow rather than replacing it.
6. **One active round per objective.** No concurrent refinements of the same
   objective; enforced by a partial unique index.

### Non-goals for v1

- Auto-refining every intake mission (deferred to a follow-up; see §12).
- Refining `inbox_items` before promotion — an inbox capture has no project,
  therefore no repository to compare against. Refine after promotion.
- A no-repository fallback via the Automations Layer / Gemini (deferred).
- Applying a proposed split into multiple objectives automatically (the
  proposal may *suggest* a split; applying it is a phase-2 acceptance option).
- Refining objectives in `submitted`, `launching`, `executing`,
  `pending_delivery`, or `complete` states.
- A live conversational surface between PM and refine agent mid-run.

## 3. Concepts and vocabulary

| Concept | Meaning |
| --- | --- |
| Refinement (round) | One request → agent run → proposal → resolution cycle for one objective. A row in `objective_refinements`. |
| Guidance | Optional PM free text attached to a request, steering that round. |
| Proposal | The agent's structured suggestion (schema in §5.4), stored verbatim on the round. |
| Resolution | `accepted` (optionally with PM edits), `rejected`, `cancelled`, or a terminal failure. |
| Source snapshot | The objective text (and revision) captured at request time, so acceptance can detect concurrent edits. |

Refinement round status (closed vocabulary on the new table):

```text
requested → running → proposed → accepted | rejected
         ↘ failed | expired | cancelled
```

- `requested` — round created; execution request queued.
- `running` — runner claimed and launched the refine agent.
- `proposed` — agent posted a valid proposal; awaiting PM resolution.
- `accepted` / `rejected` — PM resolved the proposal.
- `cancelled` — PM withdrew the round before a proposal arrived.
- `failed` — launch or agent error (recorded on the row).
- `expired` — no proposal within the deadline (default 15 minutes from launch).

## 4. Data model

New core table `objective_refinements` (both dialects, standard migration
rules; exact column types finalized in the contract-first objective):

| Column | Notes |
| --- | --- |
| `id` | UUID PK. |
| `workspace_id`, `project_id`, `mission_id`, `objective_id` | FKs; all required. |
| `round` | 1-based integer, unique per objective together with… |
| `status` | Closed vocabulary from §3. Partial unique index: at most one row per `objective_id` in (`requested`,`running`,`proposed`). |
| `guidance` | Nullable bounded text — PM steering for this round. |
| `source_objective_text` | Snapshot of `objectives.objective` at request time. |
| `source_objective_revision` | `objectives.revision` at request time. |
| `proposal_json` | Nullable; validated against the §5.4 schema, bounded (64 KB). |
| `applied_title`, `applied_objective_text` | Nullable; what acceptance actually wrote (differs from the proposal when the PM edited before accepting). |
| `resolution_note` | Nullable; PM's rejection reason or acceptance comment. Feeds the next round. |
| `execution_request_id` | Nullable FK to `execution_requests` (set when queued). |
| `agent`, `model` | Resolved launch selection recorded for provenance. |
| `requested_by`, `resolved_by` | Profile FKs. |
| `error_code`, `error_message` | Bounded; set on `failed`/`expired`. |
| `created_at`, `updated_at`, `proposed_at`, `resolved_at`, `deadline_at` | Timestamps. |

Provenance on the objective itself: none required. The accepted rewrite goes
through the existing objective-update service, which already appends
`entity_changes` and bumps `revision` transactionally (contract rule: state
transitions append `mission_events` + `entity_changes` in one transaction).
The refinement row is the durable audit of *why* the text changed and what the
agent originally proposed.

Mission events: reuse existing closed `mission_events.type` values rather than
widening the vocabulary — `update` for request/proposal arrival, `decision` for
accept/reject — with `mission_events.source = 'refinement'` (open vocabulary)
and the refinement id in the event metadata so clients can render dedicated
cards. If review prefers first-class types (`refinement_proposed`,
`refinement_resolved`), that is an acceptable alternative since this feature
bumps the contract anyway; the plan defaults to reuse to keep every existing
event consumer working unchanged.

## 5. Mechanism: original text → repo-aware agent → proposal

### 5.1 Why the launch pipeline, not a server-side LM call

Three candidate mechanisms were considered:

| Option | Verdict |
| --- | --- |
| **A. Automations Layer one-shot LM call** (Gemini, like `compose-delivery`) with server-assembled repo context | Rejected as primary. The backend — especially the Cloud edition — has no repository. Shipping repo excerpts to the server inverts Overlord's architecture, caps context at whatever we pre-select, and cannot *explore* (grep, open files, follow references) the way the use case demands. |
| **B. Hidden system objective executed through the normal mission flow** | Rejected. Pollutes the objective ledger and board, abuses lifecycle states (`executing` for something that must not edit files), and makes delivery semantics lie. |
| **C. Dedicated refinement run through the existing `execution_requests` / runner claim-and-launch pipeline** | **Chosen.** The repo, agent binaries, launch-config resolution, target selection, and credentials are already exactly there. Works identically in Local and Cloud editions. v129 already established non-objective-execution uses of the queue (`local_target_mutation`), so a new `requested_source` is precedented. |

The v129 capability-call transport (RunnerQueueProvider) was also considered —
it is for *bounded, deadline-driven* calls, while a refine run is a multi-minute
agentic exploration; the launch path with an asynchronous proposal fits better.

### 5.2 Request flow

```text
PM (webapp / CLI / MCP)
  → POST /api/objectives/:id/refinements            (service: requestRefinement)
      - validates objective state ∈ {draft, future}
      - snapshots objective text + revision
      - creates objective_refinements row (status=requested, round=N)
      - enqueues execution_requests row:
          requested_source = 'refinement'
          mission_id / objective_id set
          metadata_json.refinementId = <id>
  → runner claims (existing claim path)
      - resolves working directory exactly as a normal launch
        (objective resource_key → primary project resource → project.json)
      - NO branch/worktree preparation — refinement launches into the
        existing checkout read-only; never creates branches or worktrees
      - resolves agent/model via existing launch-config resolution
        (explicit per-round override → objective's assigned agent/model →
         resource per-agent defaults → target/workspace defaults)
      - launches the agent HEADLESS/INLINE (no terminal window), with the
        standard launch env plus OVERLORD_REFINEMENT_ID
      - marks round running, stamps deadline_at
  → refine agent (in the checkout)
      - reads the refinement briefing (§5.3)
      - explores the repository read-only
      - posts the proposal:
          ovld protocol propose-refinement --refinement-id <id> --proposal-file -
      - exits
  → backend validates proposal schema → status=proposed
      - entity_changes + mission event → realtime invalidation
      - notification to the requesting PM (existing notification catalog)
```

The agent posts the proposal itself over the protocol surface rather than the
runner parsing process stdout. This keeps the runner harness-agnostic (no
per-connector output-format coupling), reuses existing auth (the launched
process carries the user token exactly as normal launches do), and matches the
architectural rule that agents talk to Overlord through `ovld protocol`.

Failure reconciliation: if the process exits without a proposal, the runner
reports it through the existing request-failure path and the round becomes
`failed`; if nothing arrives by `deadline_at`, a backend sweep marks it
`expired`. `cancel` clears a `requested` queue entry via the existing clear
path and best-effort ignores an already-launched run (its late proposal against
a cancelled round is rejected with a named error).

### 5.3 The refinement briefing (what the agent receives)

The runner writes a briefing file (reusing the `OVERLORD_CONTEXT_FILE`
launch-variable convention) containing:

- The **original objective text** (the request-time snapshot) and mission title.
- **Intake provenance when present** — e.g. the bounded Slack thread snapshot
  and permalink from coo:880's `slack_intake_sources`, or email source text.
  This is the raw user feedback the vague objective came from; it is often
  more informative than the derived objective text.
- **PM guidance** for this round, if any.
- **Prior rounds**: each earlier proposal and its `resolution_note`, so round
  N+1 never re-proposes what the PM rejected.
- Mission context: project name, sibling objectives (titles), linked resource
  manifest (`OVERLORD_PROJECT_RESOURCES`).
- The **output contract**: the §5.4 schema, the exact
  `propose-refinement` command to run, and hard rules — read-only worktree, no
  commits, no `attach`, no `deliver`, propose exactly once.

The connector core skill (`connectors/core/overlord-mission/SKILL.md`) gains a
short "Refinement sessions" section so agents launched in this mode follow the
protocol without harness-specific prompt engineering.

### 5.4 Proposal schema

`proposal_json`, `schemaVersion: 1`, validated server-side (Zod v4), all
strings bounded:

```jsonc
{
  "schemaVersion": 1,
  "proposedTitle": "Fix duplicate delivery notifications on relaunch",   // optional
  "proposedObjective": "…rewritten, codebase-accurate instruction…",     // required
  "summaryOfChanges": "Narrowed scope to the APNs path; named the files.",// required
  "rationale": "The report describes …, which maps to …",                // required
  "assumptions": ["The user means the mobile push, not the web toast"],  // may be empty
  "questions": ["Should relaunch within 5 min suppress or re-send?"],    // may be empty
  "codeReferences": [                                                    // may be empty
    { "path": "backend/apns-client.ts", "reason": "dedupe window lives here" }
  ],
  "suggestedSplit": [                                                    // optional
    { "title": "…", "objective": "…" }
  ],
  "confidence": "high"                                                   // high|medium|low
}
```

`questions` is how the interactive loop works without a chat surface: the
webapp renders them prominently, and the PM's answers become the `guidance` of
the next round (or the PM just answers them by editing before accepting).

### 5.5 Headless launch (Connector Layer impact)

Refinement must not pop a terminal window on the PM's machine. The runner
launches refinement runs **inline** (the existing terminal-less spawn path)
using a **headless invocation** the connector adapter declares — e.g.
`claude -p <prompt-ref>` for Claude Code, `codex exec` for Codex. Concretely:

- Each adapter's manifest gains an optional headless invocation descriptor
  (command template + how the briefing is passed).
- Conformance manifests declare whether the harness supports headless runs.
- If the selected agent lacks headless support, the request fails fast with a
  named error (`refinement_agent_headless_unsupported`) and the API surfaces
  which installed agents qualify; the UI defaults to a qualifying agent.

This descriptor is deliberately generic ("headless run", not "refinement run")
so future features (e.g. auto-triage) reuse it.

## 6. Accept / reject lifecycle

All resolutions require the same authority as editing the objective
(mission-update permission on the mission), evaluated live at resolve time.

**Accept** (`POST /api/refinements/:id/accept`):

- Round must be `proposed`; objective must still be `draft` or `future` — the
  same states in which `update-objective` permits instruction-text edits today.
- Optional `title` / `objectiveText` overrides let the PM edit before
  applying; otherwise the proposal's values apply. Applied values are recorded
  on `applied_*` columns.
- **Concurrency guard:** if `objectives.revision` no longer equals
  `source_objective_revision`, the API rejects with `refinement_stale` and the
  current text; the client must re-request with `--force-stale` /
  `allowStale: true` after showing the PM a three-way view. Nothing is ever
  silently overwritten.
- Applies through the existing objective-update service path (revision bump,
  `entity_changes`, deterministic title regeneration rules untouched when a
  proposed title is present), marks the round `accepted`, and appends the
  `decision` mission event — all in one transaction.
- Accepting **does not** submit, queue, or launch the objective. Those remain
  separate explicit actions.
- Phase 2: when the proposal carries `suggestedSplit`, accept may take
  `applySplit: true` to append the split entries as new draft objectives via
  the existing add-objectives service. v1 renders the suggestion read-only.

**Reject** (`POST /api/refinements/:id/reject`):

- Round must be `proposed`. Optional `note` (stored as `resolution_note`).
- Optional `rerun: true` (+ new `guidance`) atomically opens the next round so
  "reject and try again with this steer" is one action.

**Cancel** (`POST /api/refinements/:id/cancel`): allowed in
`requested`/`running`; see §5.2.

The objective may also simply be edited or executed while a proposal sits
unresolved — refinement holds no lock. Launching/queuing the objective while a
round is in (`requested`,`running`,`proposed`) auto-cancels the round and
records that in the mission activity, since the proposal targets text that is
about to be superseded by execution.

## 7. Surfaces

### 7.1 REST (REST API Layer)

- `POST /api/objectives/:id/refinements` — body: `{ guidance?, agent?, model? }` → creates round. Requires mission-update **and** `execution_request:create`.
- `GET /api/objectives/:id/refinements` — bounded round history, newest first.
- `POST /api/refinements/:id/accept` — `{ title?, objectiveText?, allowStale?, note?, applySplit? (phase 2) }`.
- `POST /api/refinements/:id/reject` — `{ note?, rerun?, guidance? }`.
- `POST /api/refinements/:id/cancel`.
- `POST /api/protocol/propose-refinement` — agent-facing; body `{ refinementId, proposal }`; authorized by the launched user token; round must be `running` (or `requested` if the launched ack raced); rejects a second proposal for the same round (`refinement_already_proposed`).

DTOs project the full round (status, guidance, proposal, applied values,
resolution, agent/model, timestamps, error) — never launch material or tokens.
`entity_changes` rows (`entity_type: 'objective_refinement'`) drive realtime.

### 7.2 CLI (Protocol Layer — `contract/protocol-commands.yaml` additions)

```bash
# PM side
ovld protocol refine-objective  --objective-id coo:882.g5vr [--guidance-file -] [--agent claude-code] [--model …]
ovld protocol list-refinements  --objective-id coo:882.g5vr
ovld protocol accept-refinement --refinement-id <id> [--objective-text-file -] [--title …] [--allow-stale]
ovld protocol reject-refinement --refinement-id <id> [--note-file -] [--rerun] [--guidance-file -]
ovld protocol cancel-refinement --refinement-id <id>

# Agent side (inside the headless refine run)
ovld protocol propose-refinement --refinement-id <id> --proposal-file -
```

All free-text inputs follow the existing `--*-file -` heredoc convention. None
of these commands require a session key: refinement rounds are not protocol
sessions, do not attach, and never appear in the session/objective ledger.

### 7.3 MCP (hosted + local shim)

- `overlord_refine_objective` — request a round (mirrors REST create).
- `overlord_list_refinements` — read rounds.
- `overlord_resolve_refinement` — `{ refinementId, resolution: 'accept'|'reject'|'cancel', … }` mirroring the REST bodies.

These let a chat/PM-side agent drive the loop conversationally ("refine this,
then show me the diff"), while `propose-refinement` stays CLI-only because the
refine run always executes on a target with the CLI present.

### 7.4 Webapp (mission panel)

- **Entry point:** an "Improve with AI" action on draft/future objective cards
  and in the objective detail view. Disabled with an explanatory tooltip for
  other states or when no qualifying (headless-capable) agent/target exists.
- **Request affordance:** optional guidance textarea; agent/model picker
  defaulting to the resolved launch preference; shows the round going
  `requested → running` live with cancel.
- **Proposal review:** side-by-side or unified **diff of current vs proposed
  objective text**, proposed title, summary, rationale, collapsible
  assumptions/code references (paths render with the existing file-reference
  affordance), and the agent's **questions** called out above the actions.
- **Actions:** Accept · Edit & Accept (opens the proposed text in the existing
  objective editor) · Reject (note + optional "run again with guidance") ·
  round history accordion for prior rounds.
- **Provenance:** an accepted objective's activity shows the `decision` event
  card ("Refined with AI — accepted by Jake, round 2") linking the round.
- Inbox/intake tie-in: mission cards whose objective has an unresolved
  proposal show a compact indicator so intake triage surfaces "AI suggestion
  waiting" (the coo:880 provenance icon pattern is the model).

## 8. Security and authorization

- Requesting a round requires live mission-update permission plus
  `execution_request:create`; resolving requires mission-update. No caching
  beyond the request.
- The refine agent runs under the launching user's existing token with no new
  grants; `propose-refinement` authorizes that token against the refinement's
  workspace/mission and validates round state. A per-launch nonce
  (`OVERLORD_REFINEMENT_TOKEN`) hardening is a deferred option.
- Proposal content is untrusted input: schema-validated, size-bounded,
  rendered as text/diff only (never HTML/markdown-executed), and code
  reference paths are displayed, not followed server-side.
- Briefing files live under the launch scratch dir (`.overlord/tmp/sessions/…`)
  and are removed by the existing pruning rules; intake snapshots included in
  briefings respect the coo:880 disclosure rule (only authorized source
  records are ever written into a briefing).
- Refinement rows are workspace-scoped and follow existing RBAC projections;
  no cross-workspace reads.

## 9. Failure modes

| Failure | Behavior |
| --- | --- |
| No execution target online for the project resource | Request fails fast with the existing named condition; UI offers retry. |
| Selected agent lacks headless support | `refinement_agent_headless_unsupported` at request time (§5.5). |
| Agent process exits without proposing | Runner failure report → `failed` with bounded error. |
| No proposal by `deadline_at` | Sweep marks `expired`; a late proposal is rejected with `refinement_expired`. |
| Invalid proposal JSON | `propose-refinement` returns a validation error; the agent may retry within the deadline; round stays `running`. |
| Objective edited after snapshot | Accept guarded by revision check (`refinement_stale`, §6). |
| Objective deleted / mission deleted | Rounds cascade-cancel with the existing soft-delete flows. |
| Agent modifies files despite rules | Ledger evidence from refinement runs is discarded; dirty-checkout risk documented (§10). v1 mitigation: briefing rules + review-time `git status` note in runner failure metadata is **not** attempted (shared-worktree rule: never revert others' work). |

## 10. Known limitations (v1)

- **Read-only by contract, not by sandbox.** A misbehaving agent could write
  to the checkout. Mitigations: explicit briefing rules, headless
  non-interactive runs, no branch/worktree creation, and no delivery path that
  could legitimize changes. A follow-up may run refinement in an ephemeral
  read-only worktree or container.
- **`submitted` objectives are not refinable** (matches the existing
  instruction-edit rule). Whether discussion-submitted objectives should be,
  and whether accept should be allowed to pull one back to `draft`, is a
  deferred decision.
- **Cost/runtime:** each round is a real agent session on the user's
  target/plan. The deadline bounds runtime; no token budgeting in v1.

## 11. Contract impact (per CLAUDE.md, listed before implementation)

Contract version bump with:

- **Database Layer:** new core table `objective_refinements` + closed status
  vocabulary; migrations in both dialects; schema-contract doc section.
- **Protocol Layer:** six new subcommands (§7.2) in
  `contract/protocol-commands.yaml`; the rule that refinement rounds are
  sessionless; `propose-refinement` semantics.
- **REST API Layer:** endpoints in §7.1; refinement DTO; `entity_changes`
  entity type `objective_refinement`; auto-cancel-on-launch rule.
- **Runner Layer:** `requested_source = 'refinement'` handling — headless
  inline launch, no branch/worktree preparation, briefing composition,
  deadline stamping, failure reporting. (`requested_source` is already an open
  text column; the behavior, not the value, is the contract change.)
- **Connector Layer:** optional headless invocation descriptor in adapter
  manifests + conformance manifest declaration; core SKILL.md "Refinement
  sessions" section; connector version sync per the `connector-versions`
  skill.
- **MCP Server:** three new tools (§7.3) forwarding to the same service
  operations; tool-catalog entries.
- **Webapp:** mission-panel UI (§7.4); no new write paths beyond the REST
  surface.
- **Automations Layer:** explicitly unchanged; a future no-repo fallback would
  land there behind the existing null-fallback rules.
- **Editions:** identical behavior Local vs Cloud; Cloud simply depends on a
  connected runner/target, same as any launch.

## 12. Implementation phases

1. **Contract & data** — CONTRACT.md + `contract/*.yaml` updates, migrations,
   DTOs, RBAC wiring, vocabulary. *(one objective)*
2. **Core pipeline** — request/cancel service, execution-request enqueue,
   runner headless launch + briefing, `propose-refinement`, deadline sweep,
   failure paths; CLI PM commands; integration tests against a fake agent.
   *(the largest objective; CLI-testable end to end without UI)*
3. **Resolution** — accept/reject/rerun with revision guard and mission
   events; CLI + REST complete. *(can merge with 2 if sized reasonably)*
4. **Webapp** — mission-panel entry point, live round status, diff review,
   resolution actions, history.
5. **MCP + docs + drift** — MCP tools, cli/docs + docs site, `drift-review`,
   connector conformance updates.
6. **Follow-ups (separate missions):** auto-refine on intake
   (`submissionSource != 'overlord'`, per-project setting), `applySplit`,
   inbox-item refinement with project pre-selection, sandboxed read-only runs,
   no-repo Automations fallback.

## 13. Acceptance criteria

- From a vague draft objective, a PM can request refinement, watch it run, and
  receive a proposal grounded in real file references from the linked repo.
- The proposal renders as a reviewable diff with rationale, assumptions, and
  questions; accept rewrites the objective text/title exactly as approved;
  reject (optionally with guidance) can immediately start a better round.
- The objective's state never changes during refinement; accepted changes
  appear in the objective's revision/audit trail with the round linked.
- A concurrent manual edit can never be silently overwritten by acceptance.
- Refinement runs never create branches, worktrees, sessions, deliveries, or
  ledger file evidence; no terminal window appears.
- Timeouts, launch failures, unsupported agents, and offline targets all
  resolve to a terminal round status with an actionable message.
- All new writes are RBAC-checked live; proposal content is treated as
  untrusted bounded input everywhere it is stored or rendered.
- CLI, REST, and MCP expose the same capability set; docs and conformance
  manifests updated; contract bumped before code.

## 14. Deferred decisions

- First-class `refinement_*` mission-event types vs. reuse of
  `update`/`decision` with `source = 'refinement'` (§4).
- Refinement of `submitted` objectives and whether accept may demote to
  `draft`.
- Per-project default guidance (a stored "how we write objectives here"
  preamble) — likely valuable, cheap to add to the briefing later.
- Whether `questions` deserve structured answers (per-question PM replies)
  instead of free-text guidance in round N+1.
- Auto-refine triggers and rate limits for intake-created missions.
- Mission-title refinement when the mission has multiple objectives (v1 only
  proposes a title when refining the sole/first objective).
