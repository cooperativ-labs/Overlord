# Is search sufficient for a natural-language agent? (coo:781.hn9r)

Assessed against contract **v95** on 2026-08-19; **revision 2** records what
shipped in the same session under contract **v97**. Companion to
`nlp-mission-management-mcp-readiness.md` (revision 3), which this document
supersedes on the retrieval question only.

> **Revision 2 — shipped.** Two findings below are now fixed rather than
> proposed: **P0-1** (due-date filtering) and the project-name half of
> **P0-3**. See *What shipped* at the end. The rest of the document is left as
> written so the reasoning that produced those decisions stays legible.

The question: can a Gemini-Flash-class agent take a natural-language request,
turn it into a filtered search, and answer it? Tested against the two queries
named in the objective.

Findings marked **measured** were produced by running the real service harness
(`seedServiceOperator` + `createServiceContext` over an in-memory SQLite
adapter) through a scratch probe. The probe was removed; no product code
changed.

---

## Verdict

**No — but the retrieval core is no longer the problem.**

This is a different answer from the one the readiness review gave three
objectives ago, and the difference is coo:784's doing. Cross-workspace fan-out,
relevance aggregation, the coverage floor, display-id short-circuit, snippets,
matched-term evidence, project and workspace labels, `totalMatchedBeforeLimit`
and `workspaceCounts` all work now. Every defect that review raised against
ranking and scoping is fixed.

What remains is that **the agent cannot reach the data the questions are
actually about.** Query 1 fails on its last and most important step. Query 2
cannot be attempted at all.

| Query | Where it breaks |
| --- | --- |
| "Look into all the follow-up tasks on NYCA missions for the last week and tell me what I might still need to do" | Steps 1–3 work. Step 4 — reading follow-ups off objective deliveries — has no path on any agent surface. |
| "Tell me what missions are scheduled for tomorrow" | Fails immediately. There is no due-date filter, and `dueDatetime` is not in the result DTO, so the agent cannot filter *or* fall back to filtering client-side. |

---

## Query 1 — "follow-up tasks on NYCA missions for the last week"

Traced step by step as the agent would have to execute it.

### Step 1 — resolve "NYCA" to a project — *works, but brittle*

`overlord_resolve_project` resolves cross-workspace: `protocolWorkspaceId`
(`backend/protocol.ts:149-168`) derives the workspace from `--project-id` by
UUID, slug, or case-insensitive exact name across every membership in the
active organization, and 409s on genuine ambiguity. This is better than the
readiness review assumed — that review predates v95.

The brittleness is that matching is **exact only**, and there is no way to
enumerate candidates.

> **Measured.** With a project named `NYCA Portal`, resolving `"NYCA"` throws
> `Project not found: NYCA`. Resolving `"NYCA Portal"` succeeds.

`GET /api/projects` (`backend/repository.ts:1868`) already returns every
project the caller can read across all authorized workspaces — the data exists
and is correctly scoped. It is simply not on the protocol or MCP surface. An
agent handed a colloquial project name has no recovery path: it gets a 404 with
no candidate list, and a small model will then guess.

### Step 2 — "for the last week" — *works*

`dateField=updatedAt` with ISO `from`/`to`. The agent computes absolute bounds
itself; v95 deliberately specifies no implicit window and no relative-date
parsing, which is the right call — the model is better at "last week" than a
query parser would be. Worth stating explicitly in the tool description, which
currently does not.

### Step 3 — find the missions — *works*

Project filter, date bounds, status types, resource keys, relevance ranking,
labels, snippets. `overlord_search_missions` requires a stable UUID
(`mcp/server.ts:54-63`), which is consistent with the contract and fine *given
that step 1 resolved*.

### Step 4 — read the follow-ups — **blocked**

This is the step the question is actually about, and there is no path to it.

Delivery evidence lives in the `deliveries` table: `summary`,
`follow_up_notes`, and `payload_json` carrying
`deliveryReport.agentReport.humanActions` — literally the list of things a
person still has to do by hand. Three facts, together, make it unreachable:

1. **Not indexed.** `search_documents` is written by three trigger families
   only (`database/sqlite/migrations/002_initial_core.sql:964-1085`, mirrored
   in the Postgres tree): missions, objectives, and `mission_events`. The
   `deliveries` table has no trigger at all.

   > **Measured.** The index for a three-mission workspace contains exactly:
   > mission docs of `title || ' ' || display_id`; objective docs of
   > `title || ' ' || instruction_text`; event docs of `summary`. Searching for
   > text present only in a delivery summary, in `follow_up_notes`, in
   > `humanActions`, in `constraints_text`, or in `notes_text` returns **zero
   > hits** in every case.

2. **Not in mission context.** `listMissionEvents`
   (`packages/core/service/missions.ts:1112`) selects
   `id, type, phase, summary, created_at, objective_id` — `payload_json` is
   dropped. So `overlord_load_mission_context` cannot surface human actions
   even for a single named mission.

3. **No tool.** `GET /api/missions/:id/deliveries` and `GET /api/activity-feed`
   both return the full report. Neither has a protocol subcommand
   (`backend/protocol.ts` contains no `deliveries` handler) and neither has an
   MCP tool. The MCP catalogue is 15 tools; none of them reads a delivery.

So the agent can find the right missions and then has nothing to say about
them. It would most likely answer from `mission_events` summaries — plausible
prose, not the actual outstanding-work list.

Note also that "follow-up **tasks**" is an objective-level noun. Search returns
missions only, so even with delivery access the agent must fan out to
`overlord_load_mission_context` once per mission.

---

## Query 2 — "what missions are scheduled for tomorrow"

### Cross-workspace — *works*

`searchMissionsV2` (`backend/repository.ts:3894`) fans out over
`callerAuthorizedWorkspaceScopes`, org-bounded, with per-workspace RBAC and the
non-redistributed even quota v95 specifies. Results carry `workspaceId`,
`workspaceName`, `workspaceSlug`, and `workspaceCounts` reports per-workspace
matched/returned so truncation is visible.

### "Scheduled for tomorrow" — **blocked**

Missions have `due_datetime` (`missions` table; surfaced as `dueDatetime` on
`MissionDto` at `backend/repository.ts:864`). Search cannot touch it:

- `dateField` accepts only `createdAt` and `updatedAt` — validated in the
  service (`mission-search.ts`), in the REST route (`backend/index.ts:1677`),
  and documented that way in the MCP tool.
- `MissionSearchResultV2` has no `dueDatetime` field at all, so the agent
  cannot even over-fetch and filter client-side.

> **Measured.** A mission due tomorrow is returned by no date-bounded search;
> the v2 result keys are `id, displayId, title, statusType, statusId, priority,
> projectId, projectName, workspaceId, workspaceName, workspaceSlug, createdAt,
> updatedAt, objectiveCount, relevance, snippet, matchedTerms, matchedIn`.

The failure mode is worse than an error: `dateField=updatedAt` with tomorrow's
bounds returns an empty list, and `updatedAt` bounds around today return
recently-touched missions. Both look like answers. An agent will present them
as one.

This also settles the ambiguity coo:781.nzr8 raises. Reading "scheduled" as
*due date* rather than *auto-execution* is not just the better product
decision — it is the only reading with a backing column. `schedules` is a
recurrence template that writes `due_datetime` forward
(`packages/core/service/mission-schedules.ts:262`); the durable per-mission fact
is the due date. Surfacing it needs no engine.

---

## Other gaps that will bite realistic phrasings

Not required by the two example queries, but each one breaks a phrasing a user
will reach for within the first ten minutes.

| # | Gap | Query it breaks |
| --- | --- | --- |
| D | No assignee filter on search, and no `assignedTo` in the result DTO. `/api/workspace/my-missions` exists but is not on the agent surface. | "What's on my plate", "what did you assign to Sam" |
| E | No tag filter. `mission_tags` / `project_tags` exist and are unreachable from search. | "Show me everything tagged security" |
| F | No objective-level results. Search returns missions; objectives contribute to ranking but are never returned as rows. | "What tasks are queued", "which objectives are blocked" |
| G | Index covers three fields. `constraints_text`, `notes_text`, `output_format_text`, artifacts, shared context, change rationales and all delivery text are invisible. **Measured.** | "Which mission had the constraint about the ledger" |
| H | Quota is `floor(limit / workspaceCount)`, unredistributed, default limit 25. Across eight workspaces each returns three. Correct per contract, but the tool description never tells the agent to raise `limit` for broad questions or to read `workspaceCounts`. | Any vague org-wide question |
| I | No `workspaceIds` narrowing on search. | "Only look in the Cooperativ workspace" |

---

## What needs to change

Ranked by whether it unblocks a query in the objective.

### P0 — required for the two named queries

**P0-1 · Due-date filtering and `dueDatetime` on results. — SHIPPED (v97).**
Cheapest correct shape: extend the `dateField` enum to accept `dueDatetime`
alongside `createdAt`/`updatedAt`, and add `dueDatetime` to
`MissionSearchResultV2`. Both are additive. Touches the service validator, the
REST v2 route's enum check, the protocol flag pass-through, the MCP tool
description, and the contract's V2 filter-semantics bullet. Unblocks query 2
entirely.

*Alternative considered:* separate `dueFrom`/`dueTo` parameters, which would
let an agent combine "updated last week" with "due tomorrow" in one call. More
expressive, more surface. Recommend the `dateField` extension first; add the
separate bounds only if a real query needs the conjunction.

**P0-2 · Expose delivery evidence to agents.** Two complementary pieces:

- Add deliveries to `overlord_load_mission_context` (or a sibling
  `overlord_list_deliveries`), carrying `summary`, `followUpNotes`, and
  `report.agentReport.humanActions`. This is the per-mission read.
- Add an `overlord_activity_feed` tool over the existing cross-workspace
  `/api/activity-feed`, with `from`/`to` and `projectIds` filters and a
  caller-supplied limit. Today the route takes **no parameters at all** and
  hard-caps at 40 items (`backend/activity-feed.ts:32`), which is a fixed
  window rather than a query. This is the aggregate read, and it is what
  "what happened recently" and "what do I still need to do" actually want —
  matching what coo:781.nzr8 already anticipates.

Unblocks query 1's final step.

**P0-3 · Project enumeration on the agent surface. — PARTLY SHIPPED (v97).**
The recommendation below was overtaken by a better one: rather than making the
agent enumerate and match names itself, the surfaces now accept the name
directly and answer an ambiguous one with a structured choice. Enumeration is
still worth adding for the "what projects do I have" question, but it is no
longer what stands between a colloquial project name and a search. Add protocol
`list-projects` and MCP `overlord_list_projects` over the existing
cross-workspace `listProjects`. Returns id, name, slug, workspace. Small: the
service function exists and is already correctly scoped. Turns a dead-end 404
into a disambiguation the agent can run itself, and removes the only step in
query 1 that depends on the user phrasing a project name exactly.

### P1 — required before the chat interface feels like it works

**P1-4 · Assignee filter.** `assignedTo` on v2 search accepting `me` or a
member reference, plus `assignedTo` on the result DTO. "What's on my plate" is
going to be the single most common query the interface receives.

**P1-5 · Objective-level results.** Either an `entityTypes: ['mission',
'objective']` parameter on v2 search or a sibling `overlord_search_objectives`.
Needed for the natural noun in "follow-up **tasks**", and it removes the N+1
context load. Note coo:784.j6tj scoped fan-out for missions *and* objectives —
worth confirming with that mission whether the objective half is still coming
before building it here.

**P1-6 · Widen `search_documents`.** Add `constraints_text`, `notes_text` and
`output_format_text` to the mission document body, and index `deliveries` as a
fourth `entity_type`. Requires the trigger rewrite in both migration trees plus
a backfill, and the `entity_type` CHECK constraint has to grow. This is the
largest schema item in the plan and it is unambiguously this mission's —
coo:784.j6tj explicitly chose joins over denormalization, so index coverage was
never absorbed.

Sequencing note: P0-2 makes delivery evidence *readable*; P1-6 makes it
*findable*. P0-2 is enough for query 1, because the agent narrows by project
and date first and then reads. P1-6 is what makes "which mission was the one
about the Stripe secret" work. Do them in that order.

### P2 — polish

- **P2-7 · Tag filter** on v2 search.
- **P2-8 · Tool-description work**, which is the cheapest item here and
  probably the highest ratio of benefit to effort for a Flash-class model.
  `overlord_search_missions` should say: compute absolute ISO bounds yourself,
  there is no relative-date parsing and no implicit window; raise `limit` for
  broad cross-workspace questions; read `workspaceCounts` and
  `totalMatchedBeforeLimit` before claiming a list is complete; `mode:
  'fallback'` in `appliedFilters` means the query contributed nothing and the
  results are a recency listing, not an answer.
- **P2-9 · `workspaceIds` narrowing** on v2 search.

---

## Two inconsistencies worth recording

**The protocol resolves project names; MCP forbids itself from using it. — RESOLVED (v97).**
Resolved in the direction opposite to the recommendation below: the UUID gate
came off MCP rather than the resolver being narrowed. See *What shipped*.

`resolveV2SearchProjectId` (`backend/protocol.ts:530`) accepts a project id,
slug, or exact name and resolves it across the caller's workspaces. But
`optionalProjectUuid` in `mcp/server.ts:54` rejects anything that is not a UUID
before the request leaves the MCP server, so no MCP caller can ever reach that
resolver. The REST v2 route rejects non-UUIDs too (`backend/index.ts:1664`),
which matches the contract sentence "V2 accepts only stable `projectIds` … it
neither resolves project names". So the protocol surface is the odd one out,
and it diverges from the contract text rather than from the other surfaces.

Recommend keeping the UUID discipline on MCP and REST — resolution belongs in
an explicit discovery step, which is exactly what P0-3 provides — and either
narrowing the protocol resolver to match, or amending the contract bullet to
say the protocol surface additionally accepts a human project reference. The
current state is that one of the three v2 surfaces quietly does something the
contract says v2 does not do.

**`discoverProject` reads the server filesystem.**
`packages/core/service/projects.ts:926` calls `path.resolve(workingDirectory ??
process.cwd())` and walks upward looking for `.overlord/project.json`. On a
hosted MCP deployment that is the *backend's* filesystem, not the user's. The
`projectId` branch above it is fine and is the only branch a hosted client can
meaningfully use. Carried forward from the readiness review as P2-13; still
true, still unaddressed, and P0-3 gives hosted clients the discovery path they
actually need so this branch can be gated to local callers.

---

## What is explicitly *not* wrong

Recording these so the next reader does not re-investigate them.

- **Ranking.** MAX-plus-bounded-corroboration replaced the SUM defect; a
  25-event chatter mission no longer outranks an exact title match.
- **Vague queries.** The coverage floor `min(3, max(1, ceil(termCount / 2)))`
  stops a conversational sentence from returning the whole workspace, and
  `mode: 'fallback'` names the degenerate case explicitly instead of silently
  returning a recency listing.
- **Display-id lookup.** Short-circuits to an exact match; `coo:781` no longer
  returns every mission whose id starts with `coo`.
- **Disambiguation.** Results carry `projectName`, `workspaceName`,
  `workspaceSlug`, `relevance`, `snippet`, `matchedTerms` and `matchedIn`. Two
  same-titled missions in different projects are now tellable apart.
- **Status filtering.** `statusTypes` is applied, parsed by REST, sent by the
  CLI, and documented as types rather than project-defined names.
- **Cross-workspace scoping.** Org-bounded fan-out with per-workspace RBAC and
  a deterministic quota. No route selects an ambient workspace for this read.

---

## What shipped (contract v97)

Two items were implemented in the same session as this assessment, both
following a decision that reversed a recommendation made above. Recording the
reversal rather than quietly editing the recommendation, because the reasoning
matters more than the conclusion.

### Human project references on the agent surfaces

The recommendation was to keep the UUID discipline on MCP and let an
enumeration tool carry the resolution. The decision went the other way, and it
is the better one: an agent talking to a person receives the project name the
person said, and gating that to UUIDs denied the agent a resolver the protocol
already implemented — leaving it holding a bare 404 with nothing to ask about.

What changed:

- `optionalProjectUuid` is gone from both MCP surfaces — the hosted server
  (`mcp/server.ts`) and the local connector shim
  (`connectors/core/scripts/overlord-mcp.mjs`). Project references travel to the
  backend as written.
- Reference resolution is now one helper, `resolveProjectRefChoices`, used by
  both the workspace-derivation path and the V2 search filter. UUID
  short-circuits; slug and name match case-insensitively across live
  memberships.
- Ambiguity is a question, not an error. `ProjectSelectionRequiredError` is
  raised inside workspace derivation and converted at dispatch into
  `{ status: 'project_selection_required', message, projectRef, projects[] }`,
  each candidate labelled with its workspace. Because the conversion sits at
  dispatch, *every* subcommand taking `--project-id` gets it uniformly —
  `search-missions`, `statuses`, `discover-project`, mission creation — rather
  than each one growing its own variant. It mirrors the existing
  `workspace_selection_required` shape on the parentless creates.
- An additive `--workspace-id` / `workspaceId` (id, slug, or name) narrows the
  retry. It only ever narrows: it cannot widen past live membership.
- The CLI resolves names for `ovld missions list` too, and `resolveProjectByIdOrName`
  stopped silently taking the first match when a name hits in two workspaces —
  it now prints the candidates with their workspaces and asks for
  `--workspace-id`. Silently picking is how a mission ends up filed against the
  wrong board.
- REST v2 is unchanged: still UUID-only in `projectIds`, still frozen at v1 for
  the legacy route. Name resolution stays an explicit step on the HTTP surface.

The workspace labels are the load-bearing part. Without them the caller holds
two identical-looking projects and cannot phrase the question to the user.

### `dueDatetime` as a date filter

`MissionSearchDateField` accepts `dueDatetime` alongside `createdAt` and
`updatedAt`, and `MissionSearchResultV2` carries `dueDatetime` on every result.
Verified: a due-tomorrow window returns exactly the mission due tomorrow, and
the never-scheduled mission is absent rather than sorted last.

That exclusion is deliberate and is the one place this filter behaves unlike
its siblings. `missions.due_datetime` is nullable, so a due-date range asks
about scheduled work specifically. Naming the field without bounds stays a
no-op, matching the other columns.

This also commits the product to the reading argued above: a mission is
scheduled by its due date. `schedules` remains a recurrence template that writes
`due_datetime` forward — it is not a second notion of scheduling.

### Coverage

Seven new tests: six in `backend/project-reference-resolution.test.ts` covering
unique resolution, case-insensitivity, the ambiguous-name selection result,
narrowing by workspace, the same flow on board-column reads, and a genuinely
unknown project still reporting not-found; one in
`missions.search-quality.test.ts` for due-date filtering and the
never-scheduled exclusion.

### Still open from this assessment

P0-2 (delivery evidence) is untouched and remains the blocker for query 1.
P0-3's enumeration tool, P1-4 through P1-6, and the P2 items are unchanged.
