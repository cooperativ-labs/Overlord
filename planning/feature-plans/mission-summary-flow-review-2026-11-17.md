# Mission summary flow: implementation plan

Mission: coo:1294 · Consolidated: 2026-11-17 · Status: agreed plan, not implemented

Contract impact: none for this document. Each step below states its expected contract scope; classify again against the exact change, land code and contract together, and use `yarn version:contract`.

This section is the current plan. It supersedes the order tables in the three sections below it, which remain as the evidence and reasoning: the first review (findings 1–7 with source references), the second review (items A–K), and the agreed design for instruction channels.

**Goals**

1. The mission summary states the current result of the whole mission. Risks and follow-ups that a later objective completed are closed, and stay closed.
2. Each instruction reaches the agent once, on every launch path: a local terminal launch with the plugin, and a cloud agent that attaches over MCP.

**Decisions**

| # | Decision |
| --- | --- |
| D1 | Keep agent-authored summary prose and explicit item closure with a reason. No semantic auto-closure and no second summarizer. |
| D2 | The attach response is the only source of working and delivery rules. Every path calls the same core attach, so the rules arrive on every path. |
| D3 | The launch prompt only leads to attach. It tells the agent not to load the skill. |
| D4 | The skill stays available for chat-started work: the user refers to a mission or objective and asks to create, find, inspect, discuss, connect or attach. Its description says so, and says it is not needed in a session that Overlord launched. |
| D5 | The skill no longer holds attach-flow rules, so a load in a launched session costs little. No hook blocks the skill. |
| D6 | Rules for rare cases arrive in the response that triggers them, as the summary-conflict error does today. |
| D7 | Attach rules are worded by connection method. A cloud agent gets MCP tool names and payload fields, not CLI flags. |
| D8 | Attach returns no general event history and no sibling titles or summaries. It returns one ordered list of sibling objectives with state and instructions, a short `directives` list, and the mission-summary baseline. It adds no digest of completed objectives; delivery evidence is read on demand. |
| D9 | Delivery composition does not rewrite risk text. |

**Steps**

| Step | Change | Where | Done when | Contract scope |
| --- | --- | --- | --- | --- |
| 0 | Replace "Use the Overlord skill." in the launch prompt with: "Do not load the Overlord skill. The attach response carries all instructions for this session." Change the skill description per D4. | [launch.ts:425](../../cli/src/launch.ts:425); frontmatter of [SKILL.md](../../connectors/core/overlord-mission/SKILL.md); connector version workflow | Launched sessions deliver correctly without loading the skill; a chat request about a mission still loads it | None |
| 1 | New attach instructions: the revised mission-summary block (below); wording by `connectionMethod`; a line that attach takes precedence over the skill; `agentInstructions` first in the response | [protocol.ts:435](../../packages/core/service/protocol.ts:435), `assembleAgentInstructions`, `PROTOCOL_WORKFLOW` | A CLI attach and an MCP attach each return rules the caller can follow with its own tools; the instruction test guards the text | None, or patch if normative prose changes |
| 2 | Take risks from `agentReport.knownRisks` in the composed presentation; remove `knownRisks` from the model schema and writing rules | [delivery-compose.ts:615](../../packages/core/service/delivery-compose.ts:615), [compose.ts:87](../../automations/src/compose-delivery/compose.ts:87) | A risk closed or still open keeps its id and status after composition, including when the next objective attaches before composition ends | Patch |
| 3 | Move rare-case rules into responses: the skipped-item warning says what to tell the user; the `changes` read says how to declare missed paths; the deliver response says how to begin follow-up work. Remove those rules from attach. | `mission-summary-agent.ts` warnings, changes read, deliver response | Attach carries no recovery text; each case returns its own instruction | Minor if the contract specifies the fields or text; otherwise none |
| 4 | Remove changed-files, delivery-evidence and mission-summary rules from the skill. Keep chat-started work, one pointer to the attach instructions, and reference files. Deploy step 1 first. | [SKILL.md](../../connectors/core/overlord-mission/SKILL.md), `reference/`, packaged plugins | The deferred-work rule exists once, in attach; the skill is a fraction of its 6,500 words | None |
| 5 | Reduce the launch prompt to mission id, objective id, attach command, the execute rule and the step 0 line | [launch.ts:417](../../cli/src/launch.ts:417), `launch-variables.ts` | The prompt has no objectives list, recent activity, attachments or artifacts | None or minor |
| 5b | Keep agent prose when a later delivery sends none. Today such a delivery lifts the narrative guard ([worker-jobs.ts:481](../../packages/core/service/worker-jobs.ts:481)) and the fallback replaces the mission-wide summary with text about that one delivery. Observed on this mission at content revision 4. | `worker-jobs.ts` trigger guard, [mission-summary-compose-worker.ts](../../backend/mission-summary-compose-worker.ts), fallback composition | A delivery without `headline` and `summary` leaves existing agent prose in place, or the fallback keeps its still-valid content; a mission with no agent prose still gets a fallback summary | Classify in the step; a change to the narrative-protection guarantee can be major |
| 6 | Slim attach and resume-follow-up: remove `history`; add `directives` (current objective; `user_follow_up`, `decision`, `discussion_summary`; newest 10); replace `previousObjectives`/`futureObjectives` with `objectives: [{ displayId, state, objective }]` in mission order; cap completed instructions at about 600 characters; add a size-budget test | `contextForObjective`, protocol definitions, OpenAPI and generated types, CLI, MCP, connector fixtures, conformance manifests | A fresh session that resumes follow-up work still receives the user's request; a five-objective fixture stays inside the size budget | Major |
| 7 | Add an on-demand item read with paging and full detail, and `close-items` (CLI and MCP tool) | Core, REST, CLI, MCP, contract | An agent can inspect items beyond the first 60 and close an item outside delivery | Minor |
| 8 | Live status from item and objective state in the panel; grouped display of duplicate items | Web, desktop, mobile | Closing a blocker changes the visible status without a new delivery | As in the first review; lowest priority |

Steps 0 to 5 need no breaking change. Step 5b was added after a conflict during delivery of this plan showed the problem. Step 0 ships first so its effect can be seen at once. Step 4 must not reach users before step 1 is deployed, or a new plugin with an old server loses the rules.

**Measuring step 0**

Compare a few launched missions before and after:

- Was the skill loaded?
- Did the delivery carry a valid `missionSummary` and agent report?
- Did follow-up work begin with the correct command?

If the second or third fails, move that rule into attach (step 1) before continuing. If the skill still loads often, the remaining lever is step 4, which makes the load cheap. A hook that blocks the skill was considered and rejected: it would also block chat requests made later in a launched session.

**Revised mission-summary instruction block (step 1)**

The text is in the second review under "Revised instruction block". It is about 170 words, against 268 in the current attach block and 811 in the skill section. Reword its last paragraph when step 3 ships, because the conflict and skipped-item rules then arrive with those responses.

**Acceptance**

The scenarios in the first review under "Verification and acceptance" apply. Add:

- With auto-advance, objective B attaches while objective A's delivery is being composed; B closes A's risk by the id it received, and the closure holds.
- An agent does not report a risk or suggestion that is already open; no duplicate row is created.
- A cloud agent on MCP attaches, delivers with a mission summary and closes an item, using only the attach instructions.
- A launched local session delivers correctly without the skill.
- A chat session where the user names a mission loads the skill.
- A fresh session resumes follow-up work and receives the user's follow-up request in `directives`.

---

# First review


Mission: coo:1294 · Objective: coo:1294.dj3m · Reviewed: 2026-11-17

Contract impact: none. This deliverable records findings and recommendations; it changes no runtime behavior, instructions, schemas, or contract. Proposed implementation impacts are identified below. Current contract: 173.6.1.

**Recommendation**

Keep agent-authored mission prose and explicit, evidence-backed item resolution. Fix risk identity during background delivery composition, make reconciliation an explicit delivery step, and reduce attach context. The existing architecture already supports closing earlier objectives' items; replacing it with another summarizer would not address the principal gaps.

The agreed attach direction is: no general event history and no sibling-objective titles or summaries. Give the launching agent completed and future objective instructions in order, with minimal identity for targeted reads. Keep the mission-level summary and open-item baseline. Consult delivery evidence only when needed to verify a claim or close an item. Do not add a completed-objective outcome digest to attach.

**How the flow works today**

1. Connector adapters package the shared `connectors/core/overlord-mission/SKILL.md`. The backend separately emits mission-summary instructions in the attach response. This session's installed plugin and live attach both contain the current summary workflow. Source: [adapter packaging](../../connectors/adapters/codex/README.md:64), [attach instructions](../../packages/core/service/protocol.ts:435).
2. For summary-enabled missions, attach/resume return the current headline, prose, `contentRevision`, and up to 60 open risk/action/suggestion records. An empty baseline is returned before the first summary write. `load-context` and `connect` deliberately omit this editing baseline. Source: [baseline reader](../../packages/core/service/mission-summary-agent.ts:119), [protocol contract](../../contract/protocol.md:171).
3. Delivery stores the objective report, creates its live items, closes explicitly named earlier items, and optionally replaces the whole mission narrative. Prose writes check the revision before any delivery write; a conflict rolls the delivery back. Closure records the resolving objective/delivery and a reason. Source: [delivery transaction](../../packages/core/service/protocol.ts:2672), [closure and narrative write](../../packages/core/service/mission-summary-agent.ts:405).
4. A background delivery composer can revise the delivery presentation and reconcile its items. A separate mission-summary worker provides fallback prose when no current agent narrative protects it. The fallback worker never closes items. Source: [presentation persistence](../../packages/core/service/delivery-presentation.ts:114), [summary worker](../../backend/mission-summary-compose-worker.ts:269).
5. The mission panel reads open items from `mission_items`, with a separate resolved history. Historical delivery reports are not the source of current open/closed status. Risks and suggestions are deduplicated for display, but retain separate stored identities. Source: [summary projection](../../backend/mission-summary.ts:94), [summary read](../../backend/mission-summary.ts:220).

**Prioritized findings**

**1. High — a closed risk can return after the background composer paraphrases it.**

Risk identity is a hash of normalized presentation text. The delivery model may rewrite `knownRisks`, and reconciliation inserts any unmatched wording as a new open item while preserving the closed original. This can also invalidate an ID the next agent received before composition finished. Sources: [risk identity](../../database/src/mission-items.ts:73), [model writing rules](../../automations/src/compose-delivery/compose.ts:96), [accepted model risks](../../packages/core/service/delivery-compose.ts:615), [reconciliation](../../packages/core/service/mission-items.ts:330).

Reproduced with current code and an isolated in-memory database: insert “Retries may duplicate requests.”, close it as done, then reconcile “Requests can be duplicated by retries.” The result is one done original and one open paraphrase. No provider call was needed; the reproduction exercised the item lifecycle with a permitted composed presentation.

Recommendation: initially preserve agent risk text through delivery composition, as deferred work already does. If rephrasing is needed later, introduce an explicit immutable source reference and retain it through composition. Do not use semantic similarity to auto-close unrelated risks. Test delayed composition after closure and after a subsequent objective attaches. This needs a documented compatible provenance guarantee; a redesign of existing persisted identity or migration semantics would require a major contract change.

**2. High — reconciliation is supported, but the prompt does not require a systematic pass.**

The skill says to close an item only after checking it, and to rewrite the summary. It never clearly directs the agent to assess every supplied open item against this objective's work, preserve material earlier mission outcomes, or remove obsolete limitations from prose. A new objective can correctly deliver its own work while leaving the earlier warning open. Sources: [shared skill](../../connectors/core/overlord-mission/SKILL.md:255), [attach block](../../packages/core/service/protocol.ts:444).

Recommendation: make delivery preparation an explicit three-step process: reconcile supplied open items, rewrite the cumulative mission summary, inspect the closure result. Preserve still-valid earlier capabilities; update or retire claims contradicted by verified work. Keep implementation, testing, and deployment distinct. Do not re-report a resolved item in the new report. A planned objective alone is not evidence that its requested work was completed.

This is instruction clarification within the existing write protocol. It does not require a new reconciliation model, additional routine model call, or automatic semantic closure.

**3. High for long missions — attach history is noisy and can omit the relevant outcomes.**

`contextForObjective` loads `listMissionEvents` without a limit override. That query returns the **oldest** 100 events (`ORDER BY created_at ASC LIMIT 100`), with no completeness marker in attach. Launch/progress traffic can consume that entire window. Sibling objects carry requested instructions and metadata, not delivery outcomes. Sources: [context assembly](../../packages/core/service/protocol.ts:640), [event query](../../packages/core/service/missions.ts:1225), [objective shape](../../packages/core/service/missions.ts:47).

Recommendation, reflecting the discussion: remove general history from attach/resume rather than expanding it or replacing it with summaries of every completed objective. Keep completed and future instructions, in order, with IDs. Remove sibling titles and other unnecessary execution metadata from this compact projection. Keep the current objective's full execution context and the mission-summary editing baseline. Fetch evidence only for a specific uncertainty; `ovld protocol list-deliveries` / `overlord_list_deliveries` already exist, although their payload should be reviewed before recommending them as an efficient targeted read.

The existing previous/future split is positional, not based on completion. A completed higher-position objective can appear in `futureObjectives` during parallel execution. The implementation must preserve awareness of all siblings without interpreting position as completion; define the completed/pending/active grouping explicitly and retain a minimal state signal if groups alone cannot express it. Source: [positional split](../../packages/core/service/protocol.ts:406).

Removing `history` and sibling fields is a breaking protocol change. Use an attach-specific projection instead of stripping fields from `ObjectiveSummary` globally. Update attach/resume schema versions and every consumer together; preserve explicit history inspection separately. Important user decisions or constraints recorded only in events need an intentional retrieval/preservation rule, not silent loss. This does not justify retaining the whole event log by default.

**4. Medium — the bounded baseline cannot support complete reconciliation on larger missions.**

Attach takes the newest 60 items, trims text to 400 characters, and omits suggestion `change`, `location`, and `doneWhen`, plus action verification detail. `truncated` reports overflow but gives no cursor or recovery instructions. Delivery accepts at most 50 closures. An older blocking action can be hidden by newer items. Sources: [limits and projection](../../packages/core/service/mission-summary-agent.ts:37), [item ordering](../../packages/core/service/mission-items.ts:737).

Recommendation: keep the small baseline, add an authorized on-demand item read with pagination and full detail, and prioritize blocking actions in the initial page. Include a total or remaining count. Define how an agent handles more than 50 verified closures without repeated deliveries or reattaching merely to page. Until that exists, instruct agents to disclose incomplete reconciliation when `truncated` is true and never infer that absent items are resolved. This is an additive protocol/API capability, with contract updates for the read surface and closure workflow.

**5. Medium — protected agent prose can become stale between deliveries.**

All compose triggers become no-ops while the newest live delivery is the narrative's source. That includes item resolution and agent-question changes. A person can close the final blocker while prose still says the mission is blocked; the live list updates, but the prose remains unchanged. Source: [trigger guard](../../packages/core/service/worker-jobs.ts:348), [guard definition](../../packages/core/service/worker-jobs.ts:481). This is current contracted behavior, not a concurrency defect.

Recommendation: keep durable outcomes in the authored prose and derive volatile status from live mission/objective/request/item state in the UI. Avoid repeating individual risks, actions, or suggestions in prose. If prose itself must refresh between deliveries, explicitly revise the protection policy and define what evidence permits replacement. Do not simply remove the publication guard: that would reintroduce stale-worker overwrites. Weakening the current guarantee requires a major contract change.

**6. Medium — duplicate stored items can make a resolved warning appear to return.**

The same risk reported by two objectives produces two rows. The panel displays only the newest equivalent wording. Closing that row exposes the older open row. Suggestions are also deduplicated by title alone, even though identical titles can describe different work. Sources: [display deduplication](../../backend/mission-summary.ts:94), [per-delivery identity and lifecycle](../../contract/data/README.md:1506).

Recommendation: have agents assess all supplied matching records, without assuming identical wording means identical scope. For the UI, show grouped source records or an explicit count, and make the scope of resolution clear. Do not silently resolve every same-title suggestion. Changing stored identity or resolution meaning would be major; a compatible grouped display/read shape can be additive.

**7. Medium — fallback prose is deliberately lossy and cannot repair unclosed items.**

The deterministic fallback uses only the latest three objective-delivery sentences and gives an existing delivery precedence over open questions. The model path gets the first paragraph per objective, bounded objective/item lists, and the newest delivery excerpt. Neither path verifies code or resolves risk/suggestion state. Sources: [fallback algorithm](../../packages/core/service/mission-summary-compose.ts:191), [model evidence](../../backend/mission-summary-compose-worker.ts:59), [fallback instructions](../../automations/src/compose-mission-summary/compose.ts:62).

Recommendation: retain fallback as graceful degradation for old clients and conflict recovery. Have deterministic output include current blocked/in-flight status and clearly remain a limited overview. Do not describe it as complete reconciliation. Prefer improving evidence selection and preserving supported baseline outcomes over increasing all limits. Add a scenario with four completed objectives plus a new open question.

**Concise instruction proposal**

Use a short authoritative behavior block in connector core, with payload examples, CLI/MCP error envelopes, limits, and rare recovery cases in `reference/mission-summary.md`. Generate the runtime attach reminder from the same source, or test it against the same rules. Standalone MCP/CLI sessions still need a self-contained reminder; do not assume every caller loaded an installed plugin.

Proposed common block, using today's write interface:

> At delivery, update the whole mission, not only this objective. Use the mission-summary baseline, completed and future objective instructions, and verified work. Read a prior delivery only when you need evidence; objective instructions describe intent, not proof of completion.
>
> Check each supplied open risk, action, and suggestion. Close verified completed work as `done`; close obsolete items as `dismissed`, with a brief evidence-based reason. Keep uncertain or partially addressed items open. Do not re-report resolved items. If `truncated` is true, disclose the incomplete reconciliation.
>
> Rewrite the headline and summary, retaining material earlier outcomes and removing obsolete claims. State current capabilities and limits; distinguish implemented, tested, and deployed. Do not repeat live item lists. Headline: 140 characters. Summary: 1,200. Send both with `baseContentRevision`; `closeItems` may travel alone, at most 50 entries, each reason at most 280 characters. If no baseline was supplied, omit missionSummary.
>
> On `mission_summary_conflict`, merge the fresh baseline and retry once; after another conflict, deliver without prose. Inspect `closedItemIds` and warnings before claiming items were retired.

Once on-demand item pagination exists, replace the truncation instruction with the exact supported read command and bounded closure procedure. No proposed command should appear in the shipped skill before implementation.

Measured current source: the full shared skill is 6,539 whitespace-delimited words; its Mission Summary section is 811 words / 5,663 characters; the attach summary block is 268 words / 1,730 characters. Thus those two summary blocks alone contribute 1,079 words when both are loaded, before reference docs and tool schemas. These are source measurements, not tokenizer measurements or total session-context estimates. The larger saving is removing general events and redundant sibling metadata, while keeping the instruction text the user needs.

**Suggested implementation order**

| Phase | Size | Result | Expected contract scope |
| --- | --- | --- | --- |
| 1. Preserve risk identity | Small–medium | Delayed composition cannot recreate a closed risk or invalidate its baseline ID. | Compatible provenance obligation: minor; any persisted identity migration: major. Core, delivery automation, contract and tests. |
| 2. Clarify and consolidate instructions | Small | Explicit reconciliation and cumulative writing, one canonical rule source, on-demand reference detail. | None if existing obligations only; patch if normative prose needs clarification. Core protocol instructions, shared connector skill, packaged plugins, CLI/MCP guidance and version workflow. |
| 3. Slim attach | Medium | No event log, sibling titles, or objective summaries; ordered sibling instructions plus minimal identity/state, mission baseline retained. | Major. Protocol response definitions, OpenAPI/generated types, CLI, local/hosted MCP, prompt/runner consumers and connector fixtures; restamp conformance manifests. |
| 4. Add bounded item inspection | Medium | Full item detail and overflow can be inspected and verified without loading history. | Minor additive reads/closure support; core, REST, CLI/MCP and contract. Preserve workspace/project/session authorization. |
| 5. Improve live status and grouped items | Medium | Resolved blockers and duplicate sources are clear between deliveries. | Additive DTO/UI work can be minor; altered identity or narrative-protection guarantees are major. Web/desktop and mobile consumers need parity. |

For every phase, finalize the classification against the exact implementation, land code and contract together, and use `yarn version:contract`; do not hand-edit a version. These are recommendations, not newly created objectives or an approved implementation.

**Verification and acceptance**

Ran 30 existing focused tests across protocol summary writes, mission item delivery/reconciliation, pure fallback composition, and the summary worker: all passed. `yarn contract:check` passed for 173.6.1. `yarn check:conformance-versions` passed for all 12 manifests. The additional in-memory paraphrase reproduction confirmed finding 1. Other findings are source-backed behavior or explicitly identified design limitations.

Recommended acceptance scenarios: objective A reports a risk and follow-up; B implements both and closes their IDs while retaining A's still-valid outcomes; delayed presentation composition cannot resurrect either; C adds a separate outcome without regressing A/B; unresolved or partial work stays open; same-title suggestions with different scopes remain distinct; a mission with over 100 events and 60 items remains inspectable; a future-position objective completed in parallel is represented correctly; two concurrent deliveries merge through the existing conflict protocol; resolving a blocker updates visible current status; the fallback path does not claim complete mission coverage.

This review made no runtime or plugin changes, commits, or deployments. Live evidence was limited to this objective's attach/update protocol; the lifecycle reproduction and tests used local synthetic data. No production incident or production fix is claimed.

---

# Second review (coo:1294.5way, 2026-11-17)

Contract impact: none. This section adds recommendations to the plan above; it changes no runtime behavior, instructions, schemas, or contract.

**Verdict**

The plan's diagnosis holds. I re-checked findings 1, 3, 4, 5 and 6 against the cited source and each is accurate. The direction (keep agent-authored prose and explicit closure, fix risk identity, slim attach) is right. The recommendations below change the order, make three fixes smaller, close four gaps the plan does not cover, and tighten the proposed instruction block.

**Changes to the plan**

**A. Ship the instruction change first, not second.** It is the direct fix for the reported problem (completed risks and follow-ups staying open), it is the smallest phase, and it needs no contract change. The risk-identity fix protects closures that agents are not yet making reliably. Do phase 2 first, or both together.

**B. Finding 1 has a smaller fix than a provenance reference: stop sending risks through the model.** `finalizeComposedPresentation` takes `draft.knownRisks` whenever the model returns any ([delivery-compose.ts:615](../../packages/core/service/delivery-compose.ts:615)). Deferred work is already passed through untouched one line below. Do the same for risks: take them from `agentReport.knownRisks`, and remove `knownRisks` from the model's response schema and writing rules ([compose.ts:87](../../automations/src/compose-delivery/compose.ts:87), [compose.ts:107](../../automations/src/compose-delivery/compose.ts:107)). Risks can stay in the prompt as read-only evidence for the markdown. This also removes output tokens from every composition. Expected contract scope: patch (data/README.md line 1523 already defines risk identity as the text digest; the change documents that the composer preserves the text), not minor.

Two details the plan should add:

- The window is widest with auto-advance. The next objective attaches immediately after the delivery, while composition of that delivery is still running. Its baseline then carries risk ids that reconciliation deletes and re-inserts under new ids ([mission-items.ts:356](../../packages/core/service/mission-items.ts:356)), so its `closeItems` entries are skipped as `not_found`. This affects open risks, not only closed ones, and is the more common failure. Add it as an acceptance scenario.
- Deliveries composed before the fix store rows keyed on the model's wording. If any path composes a delivery again, sourcing risks from `agentReport` would re-insert the agent's wording as new open rows beside a closed paraphrase. I found no recomposition path in the compose services, but confirm this before implementation; if one exists, reconciliation must not insert a risk into a delivery that already has a closed risk row at the same position.

**C. Finding 3: the numbers support removal, and one replacement is required.** Measured on this mission's context (two objectives, about ten minutes old): the response is 17,085 characters, and `history` is 9,028 of them (53%). 25 of its 30 events are runner and launch lifecycle rows. The launch prompt already filters those types for its Recent Activity list ([launch.ts:276](../../cli/src/launch.ts:276)); attach applies no filter. No code reads `history` from the attach response; only agents do.

Removal loses one thing that matters: user direction given after the objective was written. `user_follow_up`, `decision` and `discussion_summary` events exist only in the event log. Replace the plan's open "intentional retrieval rule" with a concrete one: attach and `resume-follow-up` return a small `directives` list for the current objective only, of those three types, newest 10, and nothing else from the event log. Check `resume-follow-up` from a fresh session before removing history from it; that path may depend on the follow-up message being in the response.

**D. Finding 3: replace the previous/future split with one ordered list.** The plan keeps two groups and adds a state signal to patch the positional problem. Since phase 3 is already a major change, use one field: `objectives: [{ displayId, state, objective }]` in mission order, without the current objective. State is always present, so no grouping rule is needed and parallel execution is represented correctly. Removing titles saves almost nothing; the saving is in the nine other per-sibling fields (`missionId`, `projectId`, `assignedAgent`, `model`, `reasoningEffort`, `autoAdvance`, `resourceKey`, `position`, `displayKey`).

Also cap the instruction text of completed siblings (for example 600 characters, with a truncation marker). Completed instructions state intent, the mission summary states outcomes, and some instructions are multi-kilobyte plans. Future objectives keep their full text, because the agent must not do or defer that work. Full text stays available through `load-context --objective-id`.

**E. Finding 6: prevent the duplicate at the source.** The plan handles duplicate rows in the UI and by asking agents to close every match. The duplicate is created when an agent re-reports a risk that is already open from an earlier objective. Add one instruction: do not report a risk or suggestion that is already in `openItems`; it stays open without being reported again. The plan's block only forbids re-reporting resolved items. This makes the grouped-display work in phase 5 lower priority.

**Gaps the plan does not cover**

**F. The launch prompt duplicates attach.** The prompt that starts the session ([launch.ts:441](../../cli/src/launch.ts:441)) carries every objective's full instruction text and recent activity, and then requires attach, which returns the same content. In this session the first objective's instruction and its delivery summary each entered context twice. Since attach is mandatory, reduce the launch prompt to the mission id, objective id, the attach command and the execute-immediately rule. This is the same class of saving as finding 3 and is not in any phase.

**G. Attach instructions and the skill duplicate each other beyond the summary section.** The plan measures only the two summary blocks. The attach `agentInstructions` block is 4,663 characters; 2,439 of them are the changed-files and delivery-evidence rules, which the skill also states. Inside the skill, the deferred-work paragraph appears twice in full ([SKILL.md](../../connectors/core/overlord-mission/SKILL.md), Mode 1 and Delivery Evidence), and attach states it a third time. Apply the plan's "one canonical rule source" to all delivery rules, not only the mission summary.

**H. Choose the canonical home; the plan leaves it open.** Recommendation: the attach response is authoritative for mission-summary rules, and the skill keeps a three-line pointer plus `reference/mission-summary.md`. Reasons: attach reaches every caller including MCP sessions and old plugin versions; it is emitted only when the mission has a summary, while the skill's 811 words load in every mission session; and server text changes without a plugin release. The existing test that asserts the attach block ([protocol.mission-summary.test.ts:202](../../packages/core/service/protocol.mission-summary.test.ts:202)) then guards the only copy.

**I. "Inspect the closure result" cannot be acted on.** The plan's third step and the block's last sentence tell the agent to check `closedItemIds` before claiming items were retired. The claim is in the delivery summary and mission prose, which are already written when the response arrives, and an agent has no way to close an item outside `deliver`. Either reduce the rule to "if a close entry was skipped, say so in your final message", or add a standalone `ovld protocol close-items` command. The command would also resolve the 50-entry limit in finding 4 without a paging procedure, and lets an agent close an item when it verifies the work instead of reconstructing that at delivery. I recommend the instruction change now and the command with phase 4.

**J. The 1,200-character limit conflicts with "retain material earlier outcomes" on long missions.** The block must say how to compress, or agents will narrate objective by objective and drop the oldest. Add: organise by what the mission now provides, not by objective; merge related outcomes; drop detail that a later objective replaced.

**K. Finding 5 can be reduced by instruction.** Prose goes stale when it states a condition that a person can clear. Add: state only durable limits in prose; anything a person or a later objective can resolve belongs in an item, not in the summary. This costs nothing and leaves the publication guard unchanged.

**Revised instruction block**

Same interface as today. About 170 words, against 268 in the current attach block and 811 in the skill section.

> At delivery, update the mission summary for the whole mission, not only this objective.
>
> 1. Check every item in `missionSummary.openItems` against the work you verified. Close it as `done` if the work is complete, or `dismissed` if it no longer applies, with a reason of at most 280 characters. Leave it open if you are not sure. Objective instructions state intent; they do not prove completion.
> 2. Do not report a risk or suggestion that is already open or that you closed.
> 3. Rewrite `headline` (140 characters) and `summary` (1,200) so they are true now. Organise by what the mission provides, not by objective. Keep earlier outcomes that still hold and remove claims that later work replaced. Say whether each claim is implemented, tested or deployed. State only durable limits; do not repeat open items.
> 4. Send both with `baseContentRevision`. `closeItems` (at most 50) may be sent alone.
>
> If `truncated` is true, say in the delivery summary that not all open items were checked. On `mission_summary_conflict`, rewrite from the baseline in the error and deliver once more; if it conflicts again, deliver without headline and summary. If a close entry is skipped, say so in your final message.

**Revised order** (superseded by the implementation plan at the top)

| Order | Work | Size | Contract scope |
| --- | --- | --- | --- |
| 1 | Instruction block above; attach as the canonical source; skill reduced to a pointer and reference file; remove the duplicated delivery rules (A, E, G–K) | Small | None, or patch if normative prose changes. Connector version workflow applies. |
| 2 | Pass risks through composition unchanged (B) | Small | Patch |
| 3 | Slim the launch prompt (F) | Small | Check `launch-variables.ts` and the prompt contract; expected none or minor |
| 4 | Slim attach: remove `history`, add `directives`, single ordered `objectives` list, capped completed instructions (C, D) | Medium | Major, as in the plan |
| 5 | On-demand item read and `close-items` command (finding 4, I) | Medium | Minor |
| 6 | Live status and grouped display (findings 5 and 6) | Medium | As in the plan; lower priority after E and K |

Add a size test with phase 4: assert a character budget for the attach instruction block and for the attach response of a fixed five-objective fixture, so the saving cannot regress unnoticed.

**Verification of this review**

Read the cited code for findings 1, 3, 4, 5 and 6 and confirmed each. Measured the context response for this mission with `ovld protocol load-context`. Found no code consumer of attach `history`, and consumers of `previousObjectives`/`futureObjectives` only in `protocol.ts`, `protocol-commands.yaml` and `launch-variables.ts`. I did not re-run the plan's tests or its paraphrase reproduction, and did not test `resume-follow-up` from a fresh session. No runtime, plugin or contract files changed.

---

# Agreed design: instruction channels and remaining gaps (2026-11-17)

Contract impact: none. This section records decisions from the discussion after the second review; it changes no runtime behavior, instructions, schemas, or contract.

**Problem**

The same content reaches an agent up to three times: in the launch prompt, in the skill, and in the attach response. It must be removed without losing delivery on any launch path. There are two paths: a local terminal launch, which has the launch prompt and the plugin skill, and a cloud agent that pulls the objective over MCP, which has neither.

**Principle: attach is the only step every path goes through**

Verified: the CLI, the local MCP shim ([mcp/server.ts:712](../../mcp/server.ts:712)) and the hosted protocol route ([backend/protocol/session.ts:62](../../backend/protocol/session.ts:62)) all call the same core `attachSession`, and `resume-follow-up` builds its response with the same function ([protocol.ts:1429](../../packages/core/service/protocol.ts:1429)). Every path therefore receives the same `agentInstructions`. Anything that must arrive belongs in attach and in no other place.

Each channel gets one job:

| Channel | Who receives it | Its only job | What it stops carrying |
| --- | --- | --- | --- |
| Launch prompt | Local terminal launches | Get the agent to attach: mission id, objective id, attach command, execute-immediately rule | Objectives list, recent activity, attachments, artifacts ([launch.ts:417](../../cli/src/launch.ts:417)). Attach returns all of them. |
| Attach response | Every path | Everything needed to do and deliver this objective: the objective, sibling objectives, attachments, summary baseline, working and delivery rules | Event history (replaced by `directives`), rare-case recovery text |
| Operation responses | Every path, only when the case occurs | The rule for the next step or for recovery | — |
| Skill and plugin | Local sessions with the plugin | Work before or without attach: create, search, discuss, when to attach. Reference files for detail. | Changed-files, delivery-evidence and mission-summary rules. One line points to the attach instructions. |

**Rules for rare cases move to the response that triggers them.** The summary-conflict error already works this way: its message states the recovery steps ([mission-summary-agent.ts:326](../../packages/core/service/mission-summary-agent.ts:326)). Apply the same pattern to:

- a skipped close entry: the `mission_summary_item_skipped` warning says what to tell the user;
- capture gaps: the `changes` read says how to declare missed paths, so the 15-line changed-files block leaves attach;
- post-delivery rules: the deliver response says how to begin follow-up work.

No session then pays for these rules unless the case occurs.

**Three conditions for making attach the only source**

1. **The instructions must not depend on the CLI.** The attach block today names `ovld protocol deliver`, `--payload-file` and `--paths`. A cloud agent has MCP tools, not a CLI. `attachSession` already receives `connectionMethod`; write the rules in terms of the payload fields, and emit the CLI flags or the MCP tool names according to that value. This is a correctness gap for cloud agents today, independent of duplication.
2. **The instructions must survive truncation.** Attach output is one large JSON document, and a harness can cut long output. Removing `history` halves it on this mission. Also put `agentInstructions` first in the response, not last.
3. **Old plugin copies must not win.** Installed skills keep the old rules until the user updates. The attach block states that it takes precedence over the skill.

**Loading the skill in launched sessions**

Decided: see D3 to D5 and step 0 in the implementation plan at the top. The launch prompt tells the agent not to load the skill, the skill description is scoped to chat-started work, and the skill is trimmed so that a load in a launched session costs little. No hook blocks the skill.

**Remaining gaps: resolutions**

| Gap | Resolution |
| --- | --- |
| G. Duplicated delivery rules | Resolved by the channel table. The deferred-work rule exists once, in attach. The skill's two copies are removed. |
| H. Canonical home | Attach. The test at [protocol.mission-summary.test.ts:202](../../packages/core/service/protocol.mission-summary.test.ts:202) guards the only copy. |
| I. Closure result cannot be acted on | Now: the skipped-item warning carries its own instruction ("tell the user that item X stays open and why"). Later, with the item read: add `ovld protocol close-items` and the matching MCP tool, so an agent can close an item when it verifies the work and is not limited to 50 entries per delivery. |
| J. 1,200-character limit on long missions | In the revised block: organise by what the mission provides, not by objective. |
| K. Prose goes stale between deliveries | In the revised block: state only durable limits. The publication guard does not change. |

**Open checks from the second review, now closed**

- **Recomposition.** Delivery composition is queued in two places only: deliver and record-work ([protocol.ts:2823](../../packages/core/service/protocol.ts:2823), [protocol.ts:3274](../../packages/core/service/protocol.ts:3274)). No path composes a delivery a second time after a presentation is stored. Passing risks through unchanged is safe for existing rows, and no position-matching rule is needed.
- **Resume-follow-up.** It returns the full attach context and takes only its own `--summary`. The user's follow-up request reaches a new session only through `user_follow_up` events in `history`. The `directives` list is therefore required on `resume-follow-up` before `history` is removed; without it a fresh session resumes with no statement of what was asked.

One more cost seen in this session: `resume-follow-up` returned the full context again (about 17,000 characters plus the instructions) to a session that already had it. After the changes above this response is roughly half the size. A further reduction (a brief response when the caller says it already has context) is optional and not planned here.

**Final order** (superseded by the implementation plan at the top)

| Order | Work | Size | Contract scope |
| --- | --- | --- | --- |
| 0 | Remove the skill line from the launch prompt ([launch.ts:425](../../cli/src/launch.ts:425)); narrow the skill description if sessions still load it | Trivial | None |
| 1 | Attach instructions: revised mission-summary block; wording by `connectionMethod`; precedence line; instructions first in the response | Small | None, or patch if normative prose changes |
| 2 | Pass risks through delivery composition unchanged | Small | Patch |
| 3 | Move rare-case rules into the responses that trigger them (skipped item, capture gap, post-delivery) | Small | Minor if response fields or warning text are specified in the contract; otherwise none |
| 4 | Skill: remove duplicated rules, keep pointer and reference file. Connector version workflow applies. | Small | None |
| 5 | Launch prompt: reduce to ids, attach command, execute rule | Small | Check `launch-variables.ts`; expected none or minor |
| 6 | Slim attach: remove `history`, add `directives` (attach and resume-follow-up), one ordered `objectives` list, capped completed instructions, size-budget test | Medium | Major |
| 7 | On-demand item read, `close-items` command and MCP tool | Medium | Minor |
| 8 | Live status and grouped item display | Medium | As in the first review; lowest priority |

Steps 1 to 5 need no breaking change and remove most of the duplication. Step 4 must not ship before step 1 is deployed, or sessions with a new plugin and an old server lose the rules.
