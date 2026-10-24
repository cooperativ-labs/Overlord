# Mission-level delivery consolidation

Status: design proposal, no implementation. Contract version at time of writing: 164.

## Problem

Every delivery lives inside the accordion of the objective that produced it
(`ObjectiveEvidenceSections.tsx` → `MissionDeliveryCard`). A mission with six
objectives has six closed drawers, each holding one or more `DeliveryPresentation`
cards with their own markdown, follow-up actions, tradeoffs, known risks, and
deferred work. Nothing reads across them. To learn "what state is this mission in,
what do I still have to do, what did we give up along the way" the reader opens
each drawer in turn and mentally merges six lists.

Two things are already true that make this tractable:

- Each delivery already carries a typed, provenance-tagged report
  (`DeliveryReportPayloadV1.presentation`: `humanActions`, `tradeoffsMade`,
  `knownRisks`, `deferredWork`, `assumptions`, each item with `source` and
  `sourceRef`). The raw material for a mission-level view is structured, not prose.
- There is already an async, Gemini-backed compose pipeline
  (`worker_jobs` of type `DELIVERY_COMPOSE_JOB_TYPE`, drained by
  `backend/delivery-compose-worker.ts`, prompt in
  `automations/src/compose-delivery/compose.ts`) with a deterministic fallback.
  A mission-level composition can reuse the same job table, poller, provenance
  rules, and fallback discipline.

The goal is one consolidated surface that (a) keeps the per-objective record
intact and reachable, and (b) gives an overall sense of the mission: narrative
of what was built, outstanding human actions, risks, open issues, tradeoffs,
and suggested further objectives.

## Constraints that shape the design

- **Deliveries are the system of record.** Nothing in the consolidated view may
  be the only place a fact lives. Every rolled-up item must point back to its
  delivery and objective (`deliveryId`, `objectiveId`, item `id`).
- **Resolution state is keyed on the delivery.** `human_action_resolutions` is
  `(delivery_id, action_id)`. A consolidated view must read and write that same
  key so the Feed rail, the delivery card, and the mission view never disagree.
- **Compose must never block.** Same rule as delivery compose: the deterministic
  roll-up is always available instantly; the AI narrative arrives later and
  replaces nothing structural.
- **Reopened objectives produce new runs.** `ObjectiveRunDto` groups deliveries
  per run; a consolidation must distinguish "superseded by a later run" from
  "still current".
- **Items get resolved and promoted.** Deferred work can already be promoted to a
  mission or future objective (`outcome: mission_created | objective_added`).
  The consolidated view inherits that, and "suggested further objectives" is
  mostly the same list with a one-click promote.

## Three designs

They are ordered by how much new machinery each needs. They are not mutually
exclusive; the recommendation at the end is a sequence through them.

### Design A: Deterministic mission ledger (aggregate, no new storage)

A read-side projection over the mission's existing deliveries. No new tables,
no AI call, no contract change to the write path.

**Data.** A new read endpoint `GET /api/missions/:id/delivery-ledger` (and
protocol / MCP mirrors `mission-ledger` / `overlord_mission_ledger`) that
returns:

```ts
interface MissionDeliveryLedgerDto {
  missionId: string;
  computedAt: string;
  /** One row per delivery, oldest first: the narrative spine. */
  timeline: LedgerTimelineEntryDto[];
  humanActions: LedgerItemDto<HumanActionV1>[];     // open first, then resolved
  deferredWork: LedgerItemDto<string>[];            // open first, then resolved/promoted
  knownRisks: LedgerItemDto<string>[];
  tradeoffs: LedgerItemDto<TradeoffMadeV1>[];
  assumptions: LedgerItemDto<string>[];
}

interface LedgerTimelineEntryDto {
  deliveryId: string;
  objectiveId: string;
  objectiveDisplayId: string;
  objectiveTitle: string | null;
  runIndex: number;                 // from ObjectiveRunDto
  superseded: boolean;              // a later run of the same objective exists
  deliveredAt: string;
  oneSentence: string;              // deliveryOneSentenceSummary(), server-side
  counts: { humanActions: number; deferredWork: number; knownRisks: number; tradeoffs: number };
}

interface LedgerItemDto<T> {
  item: T;
  deliveryId: string;
  objectiveId: string;
  objectiveDisplayId: string;
  deliveredAt: string;
  superseded: boolean;
  /** Only for humanActions and deferredWork; same shape the card uses today. */
  resolution: HumanActionResolutionDto | null;
  /** Other (deliveryId, itemId) pairs this row absorbed as duplicates. */
  duplicateOf: Array<{ deliveryId: string; itemId: string }>;
}
```

Deduplication is deterministic: normalized text equality plus, for human
actions, equal `command` or equal `link`. The first occurrence wins and later
ones are listed under `duplicateOf`, so no information is dropped.

**UI.** A `MissionDeliveryLedger` section rendered below the objective
accordions in `MissionPanel.tsx`, above Notes. Layout:

1. **Timeline strip**: one compact row per delivery in order (objective display
   id, one-sentence summary, timestamp, count chips). Clicking a row opens that
   objective's accordion and scrolls to the delivery card. Superseded rows are
   dimmed with a "superseded by run N" tag.
2. **Tabbed roll-ups**: Human actions · Deferred work · Risks · Tradeoffs ·
   Assumptions. Each row reuses `HumanActionDetails` / `DeferredWorkItem` so
   mark-done, dismiss, and promote behave identically to the card. Each row has
   an "from coo:123.abcd" link back to the source.
3. Open counts surface in the section header ("3 actions · 2 deferred · 1 risk")
   so the state is readable without expanding.

**What it gives.** Everything the user listed except a narrative: human actions,
risks, open issues, tradeoffs, and further objectives (deferred work with
promote) all consolidated with provenance. Zero latency, zero hallucination
surface.

**What it lacks.** No "how things were built" story beyond the one-sentence
spine. Duplicates that are semantically equal but textually different stay
separate. Risks never get retired, because the schema has no risk resolution.

**Contract impact.** Additive REST/protocol/MCP read; webapp consumes it. No
write-path change. Minor bump.

### Design B: Composed mission brief (AI narrative on top of A)

Adds a mission-level compose job that writes a persisted `mission_briefs` row,
using the same worker pattern as delivery compose. The ledger from Design A is
the compose *input* and the deterministic *fallback*.

**Trigger.** Enqueue a `MISSION_BRIEF_COMPOSE_JOB_TYPE` job whenever a delivery
is recorded, a delivery's compose finishes, an objective is reopened, or a
human-action resolution changes. Debounce to one job per mission per ~60s
(the job table already supports a claim window). The brief is stale-tolerant:
the UI shows the previous brief with a "refreshing" marker until the new one
lands, exactly as `presentation.status === 'pending'` works today.

**Storage.**

```sql
CREATE TABLE mission_briefs (
  mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,     -- hash of (delivery ids, revisions, resolutions)
  status TEXT NOT NULL CHECK (status IN ('pending','composed','fallback')),
  brief_json TEXT NOT NULL CHECK (json_valid(brief_json)),
  generated_by TEXT NOT NULL,          -- 'deterministic' | 'gemini'
  model TEXT, generated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

`input_fingerprint` makes the job idempotent and lets the reader know whether
the brief matches the current ledger.

**Payload.**

```ts
interface MissionBriefV1 {
  schemaVersion: 1;
  status: 'pending' | 'composed' | 'fallback';
  /** 3–8 short paragraphs or bullets: what was built, in delivery order, with inline [coo:123.ab] refs. */
  narrative: string;                   // markdown
  /** Where the mission stands right now in one or two sentences. */
  stateSummary: string;
  /** Model-grouped view of the ledger; every group names the ledger rows it covers. */
  openIssues: BriefGroupDto[];         // unresolved human actions + risks the model judges live
  tradeoffs: BriefGroupDto[];
  suggestedObjectives: BriefSuggestionDto[];
  ledgerFingerprint: string;
}

interface BriefGroupDto {
  title: string;                       // model's consolidated phrasing
  detail: string;
  /** Provenance: must be non-empty; UI renders these as the real, actionable rows. */
  refs: Array<{ deliveryId: string; itemId: string }>;
}

interface BriefSuggestionDto {
  /** Full objective-quality instruction text (same rule as deferred-work enrichment, coo:986). */
  instruction: string;
  rationale: string;
  refs: Array<{ deliveryId: string; itemId: string }>;   // may be empty for a model-proposed objective
  source: 'deferred_work' | 'risk' | 'model';
}
```

**Reconciliation rules** (mirroring `reconcileDeliveryComposeDraft`):

- The model may group, rephrase, and order ledger items. It may not invent a
  human action or tradeoff. Any `BriefGroupDto` whose `refs` do not resolve to
  real ledger rows is dropped, and dropped rows fall back to their deterministic
  single-item group so nothing disappears.
- Resolution state is never in the brief. The UI joins each ref to the live
  `resolution` from the ledger at render time, so marking an action done in the
  Feed rail is reflected immediately without recompose.
- `suggestedObjectives` with `source: 'model'` are the one place the model may
  add content. They are labeled as suggestions, carry no provenance, and the only
  action on them is "add as future objective", which goes through
  `overlord_add_objectives` and so becomes a real, user-authorized record.
- Fallback brief = Design A rendered as text: narrative is the timeline spine,
  groups are one-per-item.

**UI.** Same section placement as A. Top: `stateSummary` as a single-line
status, then `narrative`. Below: the roll-up tabs from A, but rows are grouped
under the brief's headings when a composed brief exists. A "Show raw ledger"
toggle flattens back to A for people who distrust the grouping.

**What it gives.** The narrative the user asked for, consolidated open issues
instead of a flat list, and suggested next objectives in a form that can be
promoted in one click. All with the same provenance discipline the delivery
compose already enforces.

**Contract impact.** New table (Database Layer), new worker job type, new
automation in `automations/src` (registry entry), new REST/protocol/MCP read
`mission-brief`, additive. `MissionDto` could gain an optional
`briefStatus` so the board can show a stale/fresh dot, but that is not needed
for the first cut.

### Design C: Deliveries as a mission journal (change the write side)

Instead of aggregating after the fact, make each delivery append to a running
mission narrative at delivery time. The agent's `deliver` call gains an optional
`missionNarrativeDelta` ("what this changes about the mission as a whole"), and
the compose step is told the previous brief so it rewrites it incrementally.

This was considered and is **not recommended** now:

- It moves the consolidation burden onto the agent, which has the worst view of
  the mission (it has read one objective, not six). The deferred-work
  enrichment investigation (coo:986) found agents already write sparse items;
  asking for mission-level synthesis would be sparser still.
- Incremental rewriting drifts. After five deltas the brief is a palimpsest, and
  reopened objectives have no clean way to retract their earlier contribution.
  A brief recomputed from the full ledger (Design B) is always consistent with
  the record.
- It changes the agent-facing wire contract and every connector's instructions.

The one piece of C worth keeping is a per-delivery field agents *can* fill
cheaply: `objectiveOutcome: 'delivered' | 'partial' | 'blocked'`, which would
make the timeline spine in A more honest than a one-sentence excerpt. That can
be added later as an additive agent-report field.

## Comparison

| | A: Ledger | B: Brief | C: Journal |
|---|---|---|---|
| Narrative of how things were built | spine only | yes | yes, drifts |
| Consolidated human actions / risks / tradeoffs | yes, textual dedupe | yes, semantic grouping | partial |
| Suggested further objectives | deferred work + promote | yes, incl. model suggestions | agent-authored |
| Per-objective detail preserved | untouched | untouched | untouched |
| New storage | none | `mission_briefs` | delivery payload change |
| Agent-facing change | none | none | yes |
| Hallucination surface | none | bounded by refs rule | unbounded prose |
| Latency | instant | instant fallback, async upgrade | at delivery |
| Contract bump | minor, additive read | additive read + DB + automation | wire change |

## Recommendation

Ship **A, then B**, as two objectives.

1. **Ledger first.** It is the dependency for B anyway (compose input and
   fallback), it answers four of the five asks on day one, and it forces the
   dedupe and run-supersession rules to be written as pure functions in
   `packages/core/service` where they can be tested against the existing
   delivery fixtures.
2. **Brief second.** Once the ledger is stable the compose job is a thin layer:
   one new automation, one table, one worker type copied from the delivery
   compose worker with the refs-only reconciliation rule.

Placement below the accordions is right for both: the accordions are "what
happened per objective", the ledger/brief is "what it adds up to". The objective
rows stay the drill-down target via the timeline links, so nothing in the
accordion needs to change.

## Open questions for the user

- Should risks be resolvable? Today nothing retires a known risk. Extending
  `human_action_resolutions` to cover risks (it is already keyed on an opaque
  `action_id`) is cheap, and without it the Risks tab only grows.
- Should the brief be workspace-visible in the Feed, or mission-panel only?
  The Feed rail already shows cross-mission human actions; a per-mission
  `stateSummary` line there would be a natural extension but is out of scope here.
- Scope of "mission state": the brief currently reads only deliveries. Should it
  also see blocked agent requests (`AgentRequestDto`) and unanswered questions?
  They are arguably the most important "human action" of all and are not in any
  delivery report.

## Files touched per design

**A.** `packages/core/service/mission-ledger.ts` (+ tests), REST route in
`backend/`, protocol `mission-ledger`, MCP `overlord_mission_ledger`, webapp
`components/MissionDeliveryLedger.tsx` and a `useMissionLedger` query,
`MissionPanel.tsx` placement. CONTRACT.md: new read surface, version bump.

**B.** Everything in A plus `database/{sqlite,postgres}/migrations/*_mission_briefs.sql`,
`automations/src/compose-mission-brief/`, `backend/mission-brief-compose-worker.ts`,
`MISSION_BRIEF_COMPOSE_JOB_TYPE` in `worker-jobs.ts`, enqueue hooks in
`protocol.ts` (deliver) and the resolution routes, webapp `MissionBrief.tsx`.
CONTRACT.md: automation registry entry, DB table, read surface, version bump.
