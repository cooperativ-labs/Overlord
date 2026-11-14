# Objective descriptions in Simplified Technical English: proposal

Date: 2026-11-14. Mission: coo:1275. Revised under objective coo:1275.9n5a against the unified queue implemented in coo:1274. Status: implementation proposal; settled product decisions are in §10. This document changes no runtime code.

Contract impact: none for this plan and design revision. The proposed implementation has minor impact (additive columns, DTO fields, protocol flags and a worker job kind — see §9).

## 1. Problem

Agents now write and edit many objectives. A good agent instruction is long and exhaustive: file paths, constraints, edge cases, acceptance tests. That is correct for the executing agent, but a human who must decide "launch / reorder / reject this" cannot read it quickly. Today the UI shows a title (≤ 60 characters) and then the full instruction. Nothing sits between the two.

## 2. Proposal in one paragraph

Give each objective a second, human-facing text: the **description**. The instruction stays the source of truth and is the only text the executing agent receives. The description is a short summary in ASD-STE100-style Simplified Technical English (STE), written for a decision maker. By default an AI model writes it, in the same way that titles are written now. An agent or a person can also write it. The UI shows title + description; the full instruction opens on demand.

## 3. What exists today (grounding)

- **Title automation** — `automations/src/title-summarizer/` and `backend/automation/title-automation.ts`. Fire-and-forget call to OpenRouter (`gemini-3.5-flash-lite` by default) after create (`backend/repository.ts` `createMission`, `createObjective`) and after an instruction edit (`updateObjective`). Instructions ≤ 100 characters use local truncation instead of a model call. If the call fails, nothing retries it.
- **Agents can already set titles** — `title` on `create` / `add-objectives` items, and `ovld protocol update-objective --title`.
- **STE-style writing rules already exist** — `WRITING_RULES` in `automations/src/compose-delivery/compose.ts`, shared by the delivery composer and the mission-summary composer. They are an STE adaptation (sentence length 20/25, active voice, imperative, one term per item, no idioms, technical names copied exactly).
- **Durable model jobs already exist** — the mission-summary composer runs on `worker_jobs` with retries (`packages/core/service/worker-jobs.ts`, `backend/mission-summary-compose-worker.ts`).
- **Knowledgebase note** "Using ASD-STE100 … to instruct agent→user communication" (overlord workspace, `ideas/ste100-for-agent-communication.md`) holds a paste-ready Human Communication Standard prompt and argues that a glossary and a linter matter more than the prompt.

### Unified objective queue baseline

The current repository contract is 172.0.1. [ADR 0056](../../contract/decisions/0056-unify-draft-and-future-objectives.md) and [the queue implementation plan](unify-draft-and-future-objectives.md) define the baseline for this feature:

- Any number of `draft` objectives can exist. `draft` and `submitted` form one ordered queue; there is no `future` state, promotion, single-draft slot or refill operation.
- The queue head is the first draft/submitted row, including a blank row. It gets the full card; the remaining rows get compact cards. The next runnable draft is a different selector: it skips submitted and blank rows. A description never changes either selector.
- Every eligible queued objective can launch directly. Explicit Run Queue membership/order remains authoritative, including submitted entries. Descriptions do not enroll an objective, change approval, or change launch eligibility.
- Reorder names the complete live draft/submitted set and recycles its position slots. Launching, active and complete anchors stay fixed. Reopen moves the objective to the queue head and preserves evidence.
- Web uses `MissionObjectivesSection.tsx` → `SortableQueuedObjective` → `DraftObjective`, keyed by objective ID. Mobile uses the same full-head/compact-rest arrangement. There is one client-only end composer.
- `previousObjectives` and `futureObjectives` remain positional context fields, not lifecycle states. Do not rename them or add summaries to the executing agent's context.

This is a locally implemented baseline, not a claim of production rollout. [Queue release readiness](unified-objective-queue-release-readiness.md) records remaining release gates, including broad backend and interactive verification and coo:1274.91mn. This description feature neither resolves nor waives those gates.

### Two defects found while reading the title path

These matter because descriptions would copy the same pattern.

1. **Agent-supplied objective titles can be overwritten.** `createMission` always schedules `scheduleObjectiveTitleGeneration` for the first objective, even when that objective item carried its own `title`. When the async call finishes, it replaces the agent's title.
2. **No provenance.** `objectives` has no `title_source` column (chat threads have one: `pending | generated | user`). So an instruction edit regenerates the title even when a person wrote it by hand.

The description design fixes both by adding provenance to titles and descriptions together (§4.9).

## 4. Ideas, with a recommendation for each

### 4.1 One model call writes title and description together — recommended

Replace the title-only call with an "objective brief" call that returns JSON `{ title, description }`. Benefits: one request instead of two, title and description use the same terms, one place to apply STE. The description threshold (proposed ≤ ~280 characters, tune with data) is independent of the existing 100-character title threshold. Below the description threshold, keep the existing title-generation eligibility and leave `description` null. The UI then shows the instruction in the body. When only a title is eligible, request only a title; when both are eligible, request both in one call.

#### Which objectives get a summary automatically — decided 2026-11-14

Overlord writes a summary automatically only for **agent-submitted** objectives. When a person writes the objective, the instructions are already written for a person, so the summary and the instructions are the same thing.

| How the instruction text was written | Automatic summary | What the UI shows |
| --- | --- | --- |
| An agent in an attached session (`ovld protocol create`, `add-objectives`, `update-objective`, or the same MCP tools called with a session) | Yes, when longer than the threshold | The summary; the instructions behind the disclosure |
| A person in the web, desktop or iOS app | No | The instructions as the body, as today |
| An assistant over MCP or in-app chat, including without an attached session | Yes, when longer than the threshold | The summary; the instructions behind the disclosure |
| Automation (runner, inbox conversion) | No | The instructions as the body |

- Test authenticated agent/assistant authorship at each instruction write, not only at create. An attached session is not required. Include assistant writes through MCP and in-app chat; do not infer human authorship from a missing session. Persist current-instruction eligibility or provenance for later catch-up; creation provenance alone is insufficient after edits.
- For a person-written objective, `description` stays `NULL`. The instructions are not copied into it, so there is only one text to keep current.
- Every objective with long enough instructions shows a **Summarize** action. It enqueues the same brief job and stores the result with source `generated`. After that, the objective follows the normal staleness rules (§4.9): an instruction edit regenerates a `generated` summary, whoever makes the edit.
- An agent can still send its own `description` on any write. Overlord stores it with source `agent`.
- Title eligibility is unchanged: short instructions use the local title fallback, longer instructions use the model.
- Apply this policy to every eligible objective by ID, including non-head drafts and submitted rows. Queue position, card expansion and moving a row to the head do not confer agent authorship or trigger generation. Blank instructions never trigger a brief job.

**Decided:** unattached assistants qualify for automatic summaries. A person asking an assistant to write an objective does not make that instruction person-authored for this policy.

Alternative considered: a separate description call next to the title call. Rejected: twice the latency and cost, and the two texts can disagree.

### 4.2 Short prose that opens with the goal and closes with the done-when sentence — decided 2026-11-14

The description is one to three short paragraphs of plain prose. It has no headings, no labels and no bullets. It reads as a short note to the decision maker.

- **First sentence: the goal.** It says what changes, and for whom. It has a maximum of 25 words.
- **Middle:** the work, the scope, the risks and any open decision, in plain STE sentences. Use only the sentences that the instruction needs.
- **Last sentence: the done-when result.** It says what a person can observe when the work is complete. It has a maximum of 25 words.

Rules for the middle:

- Put a sentence that needs a human decision immediately after the goal. Start it with `Decision needed:` and name the options (§4.5). A decision is then never hidden at the end of the text.
- Put a sentence about a destructive or irreversible step before the sentence for that step. Start it with `CAUTION:`.
- Start a new paragraph when the topic changes, as STE requires: one topic per paragraph.

The two prefixes start sentences, not list items. The UI and later features (for example a "1 open question" badge) can still find these sentences by their prefix.

Total target: 120 words, not a hard limit. Preserve essential meaning when additional words are needed. The model returns structured JSON (`goal`, `body`, `doneWhen`), and `body` can be empty. The server joins the three parts into paragraphs: the goal starts the first paragraph and the done-when sentence ends the last paragraph. When the body is short, the result is a single paragraph. The opening and closing sentences are therefore always present, and the text still reads as prose.

Alternatives considered: a four-part layout with headed sections, and a Goal/bullets/Done-when layout. Both read as forms, not as a note. The user chose prose with a fixed opening and a fixed closing sentence.

### 4.3 Faithfulness rules in the prompt

- Do not add a fact, file, step or promise that is not in the instruction.
- Do not delete a condition, a warning or a "do not" from the instruction.
- Copy identifiers, commands, paths and display ids exactly.
- If the instruction is ambiguous or contradicts itself, say so in a `Decision needed:` sentence immediately after the goal (§4.2), using the ambiguity forms in §4.5 ("The instruction does not say which project gets the migration."). This is a useful side effect: the description becomes a cheap ambiguity check before launch.

### 4.4 Share one STE module — recommended

Move `WRITING_RULES` out of `compose-delivery` into `automations/src/writing/ste.ts` and import it from delivery compose, mission-summary compose and the new objective brief. Extend it with the knowledgebase rules that are not yet in it: "must" for a requirement and "can" for ability or permission, condition before command, `CAUTION` before the step, no contractions, no semicolons. It also adds the uncertainty rules in §4.5. One module means one change updates every human-facing text.

### 4.5 Expressing uncertainty and ambiguity — required

The style guide must be able to say "I am not sure" and "this is unclear". The knowledgebase prompt bans "should", "would", "may", "might" and "could". Taken alone, that ban removes the usual ways to hedge, and a model under that rule tends to state guesses as facts. That outcome is worse than a hedge.

The problem with those modals is not that they express doubt. Each one has more than one meaning: "should" can be an obligation or an expectation, and "may" can be permission or possibility. They also hide how sure the writer is and why. So the rule changes from "do not hedge" to "hedge explicitly": state the confidence level with a fixed phrase, and give the reason.

**Confidence vocabulary.** One phrase for each level, used the same way everywhere:

| Level | Approved form | Example |
| --- | --- | --- |
| Verified | Plain statement + evidence | "The migration adds the column. `yarn test` passed." |
| Probable | "Probably" / "The most probable cause is X, because Y." | "The failure is probably a timeout, because it occurs only on slow runs." |
| Possible | "It is possible that X." / "X is possible." + what would confirm it | "It is possible that the iOS app also reads this field. A search of the mobile repo will confirm it." |
| Not known | "X is not known." / "I did not find X." | "The owner of this table is not known." |
| Expected (future) | "I expect X, because Y." / "X will occur if Y." | "I expect the build to pass, because only comments changed." |
| Not tested | "I did not test X." | "I did not test the change on Postgres." |

**Ambiguity vocabulary.** This covers what is unclear in the source, not only the writer's confidence:

- "The instruction does not say X." For a gap.
- "The instruction says X in one place and Y in another." For a contradiction.
- "X can mean A or B." For a term with two meanings.
- "Decision needed: A or B." For an ambiguity the human must resolve. Always name the options.

**Rules added to the shared module:**

1. Do not state a guess as a fact. When you are not sure, use a phrase from the confidence vocabulary.
2. Give a reason with each "probably", "possible" or "I expect": add "because …", or name what will confirm it.
3. Do not use "should", "may", "might" or "could". Each one has two meanings. Use "must" for a requirement, "can" for ability, and the confidence vocabulary for doubt.
4. Do not stack hedges ("probably might possibly"). Use one level for each claim.
5. Do not remove uncertainty to make a sentence shorter. A doubt is a fact, the same as a warning.

**In the objective description,** ambiguity goes in a sentence immediately after the goal, using the forms above (§4.2, §4.3). Sentences that start with "Decision needed:" can later drive a UI badge ("1 open question") without another model call.

**For agent-authored text,** the same vocabulary goes into the Human Communication Standard prompt in the `overlord-mission` skill, so agent delivery summaries and descriptions report doubt the same way the composers do.

### 4.6 Deterministic STE linter — recommended for phase 2

The knowledgebase note is right that prompts drift. Add a small pure function `lintSte(text)` that returns violations: sentence > 20/25 words, ambiguous modals (should/may/might/could/would), contractions, semicolons, noun stacks > 3, passive-voice heuristics (`is|are|was|were|been + -ed`). The linter reports ambiguous modals with a suggested replacement from §4.5 ("might" → "It is possible that …"), not as a plain error. It also checks the uncertainty rules in the other direction: it flags "probably", "possible" or "I expect" with no "because" and no confirmation step in the same or the next sentence. It never flags the approved confidence forms. Use it:

- after model generation: on violations, retry once with the violations quoted; then accept the better result;
- on agent-written descriptions: never reject, but return `warnings` in the protocol response so the agent can fix them;
- as an eval metric (average sentence length, violation rate) for prompt changes.

### 4.7 Project glossary — later phase

STE allows project "technical names". A per-project glossary (canonical term + forbidden synonyms, e.g. "mission" not "ticket") injected into the prompt and checked by the linter would remove most terminology drift. Out of scope for the first release; record it as follow-up.

### 4.8 Agents can write descriptions — recommended

Mirror titles exactly:

- `create`, `prompt`, `add-objectives`: optional `description` per objective item.
- `ovld protocol update-objective --description <text> | --description-file <path|->`; an empty value removes the summary and suppresses automatic generation until a user clicks Summarize (see §10).
- REST `POST/PATCH` objective bodies and the hosted MCP tools (`overlord_create_mission`, `overlord_add_objectives`, `overlord_update_objective`) gain the same field.
- The `overlord-mission` skill tells agents: "The instruction is for the agent: be complete. The description is for the human: follow the Human Communication Standard. If you do not write a description, Overlord writes one for eligible long instructions written by an agent or assistant, whether or not it has an attached session. Otherwise, the human can use Summarize."

Agent-written descriptions are not rewritten by the model, only linted (§4.6). Address mutations by objective ID, never by queue index or “the draft”. Preserve existing surface-specific instruction-edit guards: protocol instruction edits are draft-only; submitted membership in the sortable queue does not grant protocol edit permission. Description-only editing is presentation metadata. People can edit descriptions after launch, including on completed objectives; this does not change instructions or execution evidence. Specify authorization, audit provenance and conflicts separately from instruction or lifecycle mutation.

### 4.9 Provenance and staleness rules — recommended

Add to `objectives`:

- `title_source` and `description_source`: `generated | agent | user` (`NULL` while pending).
- `description_instruction_hash`: hash of the instruction text the description was written from.

Rules when the instruction changes and the caller sends no new description:

| Current source | Behavior |
| --- | --- |
| `generated` | Regenerate while the new instruction remains eligible for a description. |
| `NULL` | Generate only under §4.1 authorship/length policy; a person-written objective remains without a summary. |
| `agent` | Regenerate and set source to `generated`. The agent's text described an instruction that no longer exists. |
| `user` | Keep. The hash no longer matches, so the UI shows "May be out of date — regenerate". |

Title provenance follows the same ownership protections, but keeps its own length/generation eligibility. Capture the instruction hash and field ownership/generation token when scheduling; compare them atomically when writing. An instruction hash alone cannot prevent overwriting a manual description edit made while the instruction stayed unchanged. Do not reject a valid result only because reorder changed the row revision.

Reorder, head changes, launch and reopen without instruction changes preserve the description, provenance and hash and schedule no new brief. A pending result follows the objective ID even if the card moves or launches. Deleted objectives accept no results. Clearing instructions invalidates pending work and hides the old summary; existing attachment/history retention and blank-draft cleanup rules stay authoritative. A short replacement instruction shows the instruction body instead of a generated summary. Keep a user-authored description as stale metadata without letting it make a blank objective appear runnable.

**Removal policy — decided:** removing a summary clears its displayed text and persists an objective-level suppression flag. Show the instructions instead. Instruction edits, catch-up scans, reorder, reopen and retries do not clear suppression. Invalidate pending description generations so an in-flight result cannot restore removed text. Only a user explicitly clicking Summarize re-enables generation; title generation remains independent. Apply this check before enqueue and again at publication.

### 4.10 Durable job instead of fire-and-forget — recommended

Titles can be lost silently today. Run the objective brief as a `worker_jobs` kind (`objective_brief_compose`) with the shared retry schedule, keyed by objective id and deduplicated, so the latest instruction edit wins. The local fallback title is still written synchronously at create time, so nothing waits on the model.

### 4.11 The executing agent never sees the description

The launch prompt keeps sending `instructionText` only. A summary must not become a second, weaker instruction. (Optional later: show the description to the *reviewing* human in the delivery card next to the result, to compare "what was asked" with "what was done".)

### 4.12 UI

Current design specification: [Objective descriptions in the unified queue](objective-descriptions-unified-queue-design.md). It includes full, compact, submitted, blank, pending and reopened states. The earlier [design canvas](https://claude.ai/artifact/EHVwTHRDpbaxEhRX9ZQA3E) predates coo:1274; the local specification supersedes its queue layout. The hosted canvas could not be retrieved during this revision and has not been edited.

- **Panel structure stays as implemented:** executed rows, non-draggable launching cards, one sortable draft/submitted queue, one end composer. Keep the surrounding mission panel, attachments, previous-run evidence and toolbar controls.
- **Full queue-head card:** title, full prose summary, source/status line, closed “Instructions · Edit” disclosure, then the existing footer. With no summary, retain the editable instruction body. A submitted head is still the full card, not a promise that automatic selection will run it.
- **Compact queued cards:** show title plus a two-line summary preview (or the existing instruction preview when no summary exists). Expand the body to read the full prose, source/status and instruction disclosure. Keep the drag handle, Run Queue controls and direct launch available without expansion or promotion. Do not hide a `Decision needed:` or `CAUTION:` behind the preview: show a small decision/caution indicator that opens the full summary.
- **Identity and focus:** keep the same objective-ID-keyed component across head/compact transitions. Store instruction and summary buffers, disclosure/expansion state and uploads by objective ID. Reorder or a realtime brief must not replace unsaved text, lose focus, remount editors, or auto-save an edit. Toolbar focus does not expand/collapse the body. Stale reorder conflicts roll back/refetch order while preserving these local buffers.
- **No summary:** long instructions expose Summarize in the open body. While pending, retain readable instructions with “Writing summary…”. On failure retain the body and expose Retry. Short/blank rows have no automatic summary; a blank row keeps its placeholder, attachments/history and existing launch guards.
- **Source line:** “AI summary”, “Written by Claude” when attribution is known (otherwise “Written by agent”), or “Edited by you”, with Edit and Regenerate. Stale user text shows “May be out of date — regenerate”. Keep the existing sparkles meaning: added by an agent.
- **Executed rows:** collapsed rows keep their title and existing evidence counts, with the agreed decision badge when applicable. Open rows show SUMMARY, collapsible INSTRUCTIONS with instruction length, then existing evidence. With no summary, show the instructions without an empty SUMMARY section.
- **Launching/reopened rows:** launching cards remain full and non-draggable. Reopened cards become the full queue head and retain their summary and Previous runs strip; no summary regeneration occurs merely because they reopen.
- **Composer:** one end composer writes instructions. It has no objective ID or summary job before save. After save, the objective follows the same authorship policy regardless of where it appears in the queue.
- iOS implements the same reading, editing, drag and direct-launch behavior in its existing ID-keyed queue. Inbox/feed cards use the same summary fallback without acquiring queue controls.

### 4.13 Missions

Out of scope. The mission-summary section already gives the mission-level human view. Mission titles keep today's path (they gain `title_source` only if cheap).

## 5. Data and API changes (summary)

- Migration (SQLite + Postgres): `objectives.description TEXT NULL`, `description_source TEXT NULL`, `description_instruction_hash TEXT NULL`, `title_source TEXT NULL`. Audit existing title provenance before choosing the title-source backfill; unknown historical custom titles must not be silently treated as replaceable. Leave descriptions `NULL`. The bounded open-draft catch-up considers every live draft/submitted row, not only the head, and applies §4.1 agent-authorship and length checks. Skip blank, deleted, launching, active and complete rows. No broad non-complete backfill and no generation on render/reorder; deduplicate catch-up by objective ID and instruction hash. Unknown authorship stays opt-in through Summarize.
- `ObjectiveDto`: `description: string | null`, `descriptionSource`, `descriptionStale: boolean`, `titleSource`. Also `ActivityFeedMissionObjectiveDto.description` if the feed card shows it.
- Create/update bodies: optional `description`.
- New worker job kind `objective_brief_compose`.

## 6. Phases

| Phase | Scope |
| --- | --- |
| 1 | Build on ADR 0056 unified queue; shared STE module, with the confidence and ambiguity vocabulary (§4.5); migration and provenance (`title_source`, description columns); fix the title-overwrite defects; objective-brief composer on `worker_jobs`; DTO fields. Contract bump. |
| 2 | Agent authorship: protocol flags, REST, MCP, CLI, skill text; STE linter with warnings and one retry. |
| 3 | Web/desktop full-head and compact queue cards, executed rows, disclosure, provenance, edit/regenerate and one end composer; ID-keyed editor preservation and queue integration checks (§11). |
| 4 | iOS (OverlordMobile repo), matching full/compact behavior and queue/editor checks. |
| Later | Project glossary; description shown on delivery cards; evals. |

## 7. Cost and latency

For eligible agent-written long instructions, one brief call replaces the title call; output grows from ~15 tokens to ~200. Person-written objectives keep title-only behavior until Summarize is requested; explicit Summarize/Regenerate and bounded catch-up are additional calls. Reorder, head changes and expand/collapse produce no calls. Debounce edits on drafts (job dedup by objective id plus a short `run_after`) so typing does not fire one call per save.

## 8. Risks

- **Summary hides a constraint.** Mitigated by the faithfulness rules, the `CAUTION` rule, and the full-instruction disclosure that is always one click away. Add fixture tests with instructions that contain "do not" clauses.
- **Uncertainty gets lost.** Mitigated by the confidence and ambiguity vocabulary (§4.5) and the linter check for unsupported hedges (§4.6).
- **STE reads robotic.** Acceptable for a decision summary; this is the intended register. Keep chat outside this feature.
- **"STE-compliant" claims.** The ASD dictionary is not shipped. Call it "Simplified Technical English style", not "ASD-STE100 compliant".
- **Stale user descriptions.** Shown as stale, never silently replaced.

## 9. Contract impact: minor

Proposed feature implementation only; this documentation revision has no runtime contract impact. Build on the unified-queue contract and preserve its state vocabulary, selection rules, complete-set reorder and positional context fields. The description feature is additive; it does not repeat the queue major migration. If released with coo:1274, the combined release remains major. Use `yarn version:contract minor` when implementing these additions and land the contract, ADR, migrations, schemas and generated artifacts with the code. Affected modules:

- `contract/` — `data/` (new columns and `*_source` vocabulary), `api/openapi.yaml` (DTO and body fields), `protocol-commands.yaml` (new `--description` flags), `architecture.md` (new worker job kind, if job kinds are enumerated there).
- `database` — migration for both editions.
- `packages/core` — objective service, provenance rules, job enqueue.
- `automations` — shared STE module, objective-brief composer, linter.
- `backend` — routes, worker registration, replace title scheduling.
- `cli`, `mcp`, `connectors` (skill text, connector version bump) — new field and flags.
- `webapp` / `desktop` — UI. iOS consumes the additive DTO fields; old clients ignore them.

## 10. Questions for the decision maker

1. Layout of the description? **Decided 2026-11-14:** one to three prose paragraphs that open with the goal sentence and close with the done-when sentence, with no headings or bullets (§4.2).
2. Can a person edit the description, or only regenerate it? **Decided 2026-11-14:** edit allowed, including after launch and completion. Attribute the editor correctly; show "Edited by you" only to that editor.
3. Backfill existing open objectives, or generate only on new or edited ones? **Decided 2026-11-14:** new/edited only, plus eligible open draft/submitted queue entries under §4.1; no wider backfill.
4. Should the title also move to strict STE (it is already verb-first and short)? **Decided 2026-11-14:** yes, through the shared module, no other change.
5. Show the summary on collapsed executed rows? **Decided 2026-11-14:** no. The summary shows only in an open row; the title explains a closed row (§4.12).
6. Which objectives get a summary automatically? **Decided 2026-11-14:** agent/assistant-written objectives qualify with or without an attached session, including MCP and in-app chat. For a person-written objective, the instructions are the summary, and a Summarize action makes one on request (§4.1).

7. Is 120 words a hard limit? **Decided:** no, it is a target; essential meaning takes priority.
8. What does removing a description do? **Decided:** keep it removed and show instructions until a user clicks Summarize. Persist suppression across instruction edits and catch-up; reject pending results after removal. Regenerate remains a separate request to replace an existing summary.

## 11. Queue integration acceptance criteria

These checks supplement the STE fidelity/provenance tests. Use the matching unified-queue backend and both web/mobile clients; retain existing queue regression ownership.

1. Create several long agent-authored drafts in one request. Each eligible ID gets its own brief; the full head and compact remaining cards show the correct result. Person-authored and blank rows retain their instructions without automatic summaries.
2. Put a submitted or blank row at the head. It receives the full layout, but automatic runnable-draft selection still skips it. Submitted rows remain draggable and explicitly launchable. Explicit Run Queue dispatch remains authoritative.
3. Drag the head down and a compact row up with an instruction edit, description edit and staged attachment in progress. Preserve buffers, focus, disclosures, uploads and the ID-to-summary association. Reorder sends every draft/submitted ID and leaves launching/active/history slots fixed.
4. Race generation with reorder, manual summary editing, instruction editing, deletion and launch. Position-only changes accept a still-current result; stale instruction/ownership results never overwrite edits or resurrect deleted data. Summary arrival never changes lifecycle or Run Queue membership.
5. Launch a non-head objective while its brief is pending. It launches under existing rules with full instructions only; no wait for the model and no promotion. Pending/failure states remain readable.
6. Reopen an executed objective. It becomes the full head, retaining description/provenance, attachments and Previous runs evidence. No model call occurs unless instructions change or regeneration is requested.
7. Reject a stale/incomplete reorder, refetch server order and preserve unsaved buffers by ID. A brief arriving during recovery does not restore an obsolete order.
8. Exercise full/compact no-summary, pending, failure, generated, agent-authored, user-edited and stale states. Decision/caution indicators reveal the complete prose. Keyboard and touch users can read instructions and launch eligible compact cards without dragging.
9. Catch up all eligible open draft/submitted IDs, including non-head rows. Do not generate for person-authored/unknown-origin, blank, deleted or already-started rows; deduplicate repeat scans. Opening or dragging a card causes no jobs.
10. Preserve positional `previousObjectives`/`futureObjectives` response fields and executing-agent instruction-only context. Verify protocol draft-only instruction guards independently from REST and description-only permissions.

11. Remove a summary while generation is pending, then edit instructions, reload, reorder, reopen and run catch-up. The summary stays absent and instructions remain visible. A late result cannot restore it. A user clicking Summarize re-enables generation; title behavior is unaffected.

Run focused service/job/DTO tests with each backend phase, UI tests with each client phase, then matching-client interaction checks and applicable contract/parity/generated-artifact gates before release. This objective revises the plan and design only; it does not claim these future implementation checks have run.
