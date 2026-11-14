# Objective description plan review

Date: 2026-11-14. Mission: coo:1275. Objective: coo:1275.ak8z.

Contract impact: none. This review changes no runtime behavior or normative contract. The proposed feature remains an additive minor change against contract 172.0.1, provided implementation preserves existing permissions and lifecycle meanings.

Reviewed: [implementation proposal](objective-descriptions-ste.md), [queue design](objective-descriptions-unified-queue-design.md), current title automation, objective creation/update paths, shared worker jobs, and relevant data/architecture contracts. This is a source-backed design review, not runtime or production verification.

## Assessment

The direction is sound. Keep full instructions authoritative, summaries optional, and launch independent of generation. The revised design correctly separates queue layout from runnable selection and preserves objective identity through reorder and reopen. Keep the six product decisions already recorded in §10.

The plan is not implementation-ready yet. Resolve the four product choices below and specify the persistence/API behavior before starting migrations. The most consequential gaps concern losing a new generation request, misidentifying the author of edited instructions, and presenting a short summary as if it preserved every constraint.

## Required fixes

### 1. Make generation durable beyond merely adding a job kind — high

Plan §§4.9–4.10 mention an instruction hash and ownership token, but §5 persists only the hash and source. No token, generation status, failure state or request API is specified. The design nevertheless promises Pending, Retry and Regenerate across clients and reloads.

The current `enqueueWorkerJob` in `packages/core/service/worker-jobs.ts` returns the existing queued/running job without replacing its payload or scheduling a successor. Deduplicating only by objective ID can therefore lose an edit: job A runs, edit B is deduplicated, A fails its stale-write check, and B never runs. A debounce is also not implemented by that helper's interface.

**Recommendation:** specify a persistent desired generation/version and field-specific ownership versions; transactional request/enqueue; pending/running/failed/ready projection; and atomic publication. A running job must either reload and satisfy the latest desired generation or leave a successor guaranteed to run. Protect title and description independently so a description-only request cannot overwrite a custom title. Test repeated Regenerate, edit-during-run, manual edit without instruction change, worker restart, lease expiry, deletion, reorder and launch on both databases. Use the existing namespaced job convention, for example `overlord.objective.brief.compose.v1`.

### 2. Creation provenance does not identify the current instruction author — high

§4.1 says authorship is tested on each write and needs no new column; §5 then uses that policy for open-draft catch-up. The contract's `created_by_*` columns describe who created the row. They cannot distinguish an agent-created draft subsequently rewritten by a person from the reverse case. The live update request supplies this context, but a later catch-up scan does not.

**Recommendation:** persist current-instruction generation eligibility or its authenticated author provenance, separately from creation provenance. Alternatively, limit catch-up to records whose current text authorship can be established, and skip unknowns. Do not rewrite `created_by_*`. Enqueue from the common transaction/service path so REST, protocol, MCP, chat, inbox conversion and batch creation follow one rule. Add tests for both directions of authorship change and for no-session MCP writes.

### 3. A 120-word summary cannot promise to preserve every condition — high

§4.3 says not to delete any condition, warning or prohibition. That is not compatible with summarizing arbitrarily long instructions to 120 words. The mandatory observable done-when sentence can also invent an acceptance criterion when the source has none. A style linter cannot verify either semantic requirement. Deferring evals to “Later” leaves the core product claim untested.

**Recommendation:** prioritize decision-relevant scope, irreversible actions, prohibitions and uncertainty. Never invent a completion test: say the instruction does not specify it. When those facts do not fit, use the product fallback selected below. Ship fidelity fixtures in phase 1: dense constraints, absent completion criteria, contradictory instructions, quoted modals, code/paths, prompt-injection text, and multiple decisions. Keep instruction text as untrusted model input. Validate structured output and render it safely. Treat style violations as advisory; malformed or materially unfaithful output must fall back to readable instructions rather than “accept the better result.” Do not claim a heuristic linter proves fidelity or full ASD compliance.

### 4. Define summary mutations and permissions before exposing UI controls — high

§4.8 correctly calls for a separate description-only policy but leaves it unspecified. No concrete Summarize/Regenerate/Retry request, conflict response, or permission/lifecycle matrix appears in §5. Human edit permission is settled; whether it extends to executing and completed objectives is not.

**Recommendation:** specify create/edit/clear/summarize/regenerate/retry semantics across REST, protocol and MCP, including omitted versus null versus empty string, input limits, optimistic concurrency, authorized project/workspace resolution, and structured warning responses. Preserve draft-only protocol instruction guards. Resolve the metadata policy below without allowing a description mutation to bypass an instruction guard. Job/status reads must retain objective authorization and must not expose raw provider failures.

### 5. Clearing, staleness and title ownership have conflicting or incomplete rules — medium

§4.8 says clearing returns to generation; §4.1 permits automatic generation only for certain authors, with explicit Summarize as an exception. There is no durable representation for “show instructions and keep this summary removed.” §4.9 changes an agent summary to generated after an instruction edit, but says titles follow the same ownership protections, despite identifying overwrite of custom titles as a defect. A generated summary that becomes short/ineligible also needs an explicit storage and stale-display rule.

**Recommendation:** define a table for each field and operation. Separate removing a summary from regenerating it. Preserve custom titles until an explicit replacement/regeneration request; adopt a conservative policy for unknown legacy title provenance. Keep historical/stale text separate from current display eligibility. Record the author of the description edit if attribution is shown: `description_source = user` alone cannot justify “Edited by you” to every collaborator. Prefer “Edited by a person” without actor data.

### 6. Use one composer schema and stable UI metadata — medium

§4.1 requests `{ title, description }`; §4.2 requests `{ goal, body, doneWhen }`. Neither defines the body type, paragraph boundaries, title-only response or field-specific generation. Decision/caution badges depend on matching prose prefixes, including in agent/person-authored text; an “open decision” count could remain after a decision is resolved elsewhere.

**Recommendation:** choose one versioned internal schema with optional title and structured description parts, deterministic paragraph assembly and separate field eligibility. Specify detection after manual edits and identify badges as “decision mentioned”/“caution mentioned,” not a tracked unresolved-decision state. Do not let missing badges imply that the instructions contain no risk. If actual resolution tracking is wanted, treat it as separate product scope.

### 7. Complete the delivery surface and event inventory — medium

The plan lists DTO changes but does not define generation-status projection, realtime events, audit attribution or where descriptions must be excluded. Adding description to a shared objective DTO can accidentally expose it through attach/load-context or launch assembly despite §4.11. The current title store publishes an objective change event; the new worker needs equivalent authorized client refresh behavior.

**Recommendation:** inventory objective list/detail, activity feed, web/desktop, mobile, REST mutation responses, protocol/MCP responses, attach/load-context and launch projections. Keep execution contexts instruction-only through explicit projection tests, while returning authored-field warnings through mutation responses. Specify whether presentation-only writes affect activity ordering, unread indicators, mission-summary triggers and notifications; recommend no new work/decision notifications merely because generation finished. Include both edition workers and older-client compatibility in release checks.

### 8. Narrow the shared STE rollout and define operational failure — medium

§4.4 changes delivery and mission-summary writing behavior as well as objective briefs. §4.13 leaves mission titles on their existing path, while §10 says titles use strict STE “with no other change”; the precise scope is unclear. There is also no first-release behavior for a Local install with no model credentials, sustained provider failure or a large eligible catch-up backlog.

**Recommendation:** first extract existing shared rules without behavioral change, then apply new objective rules through an explicit profile. Broaden other composers only with their own regression fixtures. State that the settled strict-title decision applies to objective titles unless broader scope is approved. Keep missing-provider installations fully usable with local titles and instructions, expose an actionable unavailable state, and bound worker concurrency/catch-up batches. Include input/output limits and the configured provider timeout; generation never blocks launch.

## Product choices still needed

These refine the accepted decisions; they do not reopen prose layout, human editing, agent-only automatic summaries, bounded catch-up, strict objective titles or collapsed executed-row layout.

| Choice | Recommendation | Alternative and consequence |
| --- | --- | --- |
| What wins when essential information exceeds 120 words? | Treat 120 as a target, permit a bounded longer summary, and fall back to instructions when a faithful brief cannot be produced. | Hard cap: fall back to instructions more often; never silently drop critical constraints. |
| Can descriptions be changed after launch/completion? | Allow explicit human presentation edits/regeneration with audit provenance; preserve instructions and execution evidence. Limit agent mutation to the existing editable planning scope initially. | Freeze descriptions after launch: simpler historical meaning, but people cannot correct a misleading summary on executed rows. |
| Does Remove mean “keep showing instructions”? | Yes: distinguish Remove from Regenerate; suppress automatic regeneration until explicit Summarize re-enables it. | Reset-to-auto: simpler state, but a removed summary can immediately return. |
| Does an unattached assistant count as human authorship? | Retain the plan's session-based rule for v1 and explain it in the tools: no automatic summary without attachment, but explicit descriptions/Summarize remain available. | Count all authenticated agent-origin tool writes: broader coverage, but changes the accepted person-requested MCP/chat behavior. |

## Recommended revision and verification order

1. Resolve the four choices and write the mutation/state tables. Specify persisted generation intent, current-instruction eligibility, independent field ownership and API status projection.
2. Reconcile the composer schema, fidelity fallback, title ownership and attribution. Move essential fidelity evaluation into phase 1; keep the glossary and broad stylistic tuning deferred.
3. Update the plan and local design together. Keep the unified-queue release gates independent; this feature cannot waive them.
4. Implement each backend slice with its contract/ADR/migration/generated-artifact changes and focused database/service tests. Ship the matching clients only after event, editor-preservation, accessibility and instruction-only context checks pass.

No runtime tests were run for this documentation-only review. Findings are based on the current local sources; no deployment state or hosted design-canvas verification is claimed.
